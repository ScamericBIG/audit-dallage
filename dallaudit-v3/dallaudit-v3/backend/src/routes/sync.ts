import type { FastifyPluginAsync } from 'fastify';
import { pool } from '../db.js';
import type pg from 'pg';

type MutationOp = 'createObs' | 'updateObs' | 'deleteObs' | 'movePhoto' | 'deletePhoto';

interface IncomingMutation {
  clientMutationId: string;
  op: MutationOp;
  obsId: string;
  enqueuedAt: number;
  payload: any;
}

interface MutationResult {
  clientMutationId: string;
  status: 'applied' | 'conflict' | 'error' | 'noop';
  obsId: string;
  serverVersion?: any;
  error?: string;
}

const syncRoutes: FastifyPluginAsync = async (app) => {
  const auth = { preHandler: [app.authenticate] };

  // --- Heartbeat ------------------------------------------------------------
  app.get('/health', async () => ({ ok: true, t: Date.now(), v: 3 }));

  // --- Pull delta -----------------------------------------------------------
  app.get<{ Querystring: { sinceMs?: string; auditId?: string } }>(
    '/sync/pull',
    auth,
    async (req) => {
      const since = Number(req.query.sinceMs ?? 0);
      const auditId = req.query.auditId;

      const obsQ = auditId
        ? await pool.query(
            `SELECT id, audit_id, ref, pathology_code, x, y, severity, description,
                    quantity, photo_ids, created_at, updated_at
             FROM observations
             WHERE updated_at > to_timestamp($1 / 1000.0) AND audit_id = $2
             ORDER BY updated_at ASC`,
            [since, auditId]
          )
        : await pool.query(
            `SELECT id, audit_id, ref, pathology_code, x, y, severity, description,
                    quantity, photo_ids, created_at, updated_at
             FROM observations
             WHERE updated_at > to_timestamp($1 / 1000.0)
             ORDER BY updated_at ASC`,
            [since]
          );

      const photosQ = await pool.query(
        `SELECT p.id, p.observation_id, p.url, p.bytes, p.mime_type, p.created_at
         FROM photos p
         WHERE p.created_at > to_timestamp($1 / 1000.0)
         ORDER BY p.created_at ASC`,
        [since]
      );

      return {
        serverTime: Date.now(),
        observations: obsQ.rows,
        photos: photosQ.rows,
      };
    }
  );

  // --- Batch push mutations -------------------------------------------------
  app.post<{ Body: { clientId: string; mutations: IncomingMutation[] } }>(
    '/sync/mutations',
    auth,
    async (req, reply) => {
      const { clientId, mutations } = req.body ?? ({} as any);
      if (!clientId || !Array.isArray(mutations)) {
        return reply.code(400).send({ error: 'Requête invalide' });
      }

      const results: MutationResult[] = [];
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const m of mutations) {
          try {
            results.push(await applyMutation(client, clientId, m));
          } catch (err: any) {
            results.push({
              clientMutationId: m.clientMutationId,
              obsId: m.obsId,
              status: 'error',
              error: err.message ?? 'Erreur inconnue',
            });
          }
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        app.log.error({ err }, 'sync batch failed');
        return reply.code(500).send({ error: 'Échec batch sync' });
      } finally {
        client.release();
      }

      return { serverTime: Date.now(), results };
    }
  );
};

async function applyMutation(
  client: pg.PoolClient,
  clientId: string,
  m: IncomingMutation
): Promise<MutationResult> {
  switch (m.op) {
    case 'createObs': return applyCreateObs(client, clientId, m);
    case 'updateObs': return applyUpdateObs(client, m);
    case 'deleteObs': return applyDeleteObs(client, m);
    case 'deletePhoto': return applyDeletePhoto(client, m);
    default:
      return { clientMutationId: m.clientMutationId, obsId: m.obsId, status: 'error', error: `Op inconnue: ${m.op}` };
  }
}

async function applyCreateObs(client: pg.PoolClient, clientId: string, m: IncomingMutation): Promise<MutationResult> {
  const p = m.payload;
  const existing = await client.query('SELECT * FROM observations WHERE id = $1', [m.obsId]);
  if (existing.rowCount! > 0) {
    return { clientMutationId: m.clientMutationId, obsId: m.obsId, status: 'noop', serverVersion: existing.rows[0] };
  }
  const inserted = await client.query(
    `INSERT INTO observations
       (id, audit_id, ref, pathology_code, x, y, severity, description, quantity, created_by_client, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, to_timestamp($11/1000.0), to_timestamp($12/1000.0))
     RETURNING *`,
    [m.obsId, p.auditId, p.ref, p.patho, p.x, p.y, p.sev ?? 'normal', p.desc ?? '', p.qty ?? 0,
     clientId, p.createdAt ?? Date.now(), p.updatedAt ?? Date.now()]
  );
  return { clientMutationId: m.clientMutationId, obsId: m.obsId, status: 'applied', serverVersion: inserted.rows[0] };
}

async function applyUpdateObs(client: pg.PoolClient, m: IncomingMutation): Promise<MutationResult> {
  const p = m.payload;
  const incomingTs = Number(p.updatedAt ?? 0);
  const current = await client.query(
    `SELECT *, extract(epoch from updated_at) * 1000 AS updated_at_ms FROM observations WHERE id = $1`,
    [m.obsId]
  );
  if (current.rowCount === 0) {
    return { clientMutationId: m.clientMutationId, obsId: m.obsId, status: 'conflict', serverVersion: null };
  }
  const serverTs = Number(current.rows[0].updated_at_ms);
  if (incomingTs < serverTs - 50) {
    return { clientMutationId: m.clientMutationId, obsId: m.obsId, status: 'conflict', serverVersion: current.rows[0] };
  }
  const updated = await client.query(
    `UPDATE observations SET
       ref = COALESCE($2, ref), pathology_code = COALESCE($3, pathology_code),
       x = COALESCE($4, x), y = COALESCE($5, y),
       severity = COALESCE($6, severity), description = COALESCE($7, description),
       quantity = COALESCE($8, quantity), updated_at = to_timestamp($9/1000.0)
     WHERE id = $1 RETURNING *`,
    [m.obsId, p.ref, p.patho, p.x, p.y, p.sev, p.desc, p.qty, incomingTs || Date.now()]
  );
  return { clientMutationId: m.clientMutationId, obsId: m.obsId, status: 'applied', serverVersion: updated.rows[0] };
}

async function applyDeleteObs(client: pg.PoolClient, m: IncomingMutation): Promise<MutationResult> {
  await client.query('DELETE FROM photos WHERE observation_id = $1', [m.obsId]);
  const r = await client.query('DELETE FROM observations WHERE id = $1', [m.obsId]);
  return { clientMutationId: m.clientMutationId, obsId: m.obsId, status: r.rowCount! > 0 ? 'applied' : 'noop' };
}

async function applyDeletePhoto(client: pg.PoolClient, m: IncomingMutation): Promise<MutationResult> {
  await client.query('DELETE FROM photos WHERE id = $1', [m.payload.photoId]);
  return { clientMutationId: m.clientMutationId, obsId: m.obsId, status: 'applied' };
}

export default syncRoutes;
