import type { FastifyPluginAsync } from 'fastify';
import { query } from '../db.js';
import { v4 as uuidv4 } from 'uuid';

const observationRoutes: FastifyPluginAsync = async (app) => {
  const auth = { preHandler: [app.authenticate] };

  app.get<{ Params: { id: string } }>('/:id', auth, async (req, reply) => {
    const res = await query(
      `SELECT o.*,
              ARRAY(
                SELECT json_build_object('id', p.id, 'url', p.url, 'bytes', p.bytes, 'mime_type', p.mime_type)
                FROM photos p WHERE p.observation_id = o.id ORDER BY p.created_at
              ) AS photos_detail
       FROM observations o WHERE o.id = $1`,
      [req.params.id]
    );
    if (!res.rows[0]) return reply.code(404).send({ error: 'Observation introuvable' });
    return res.rows[0];
  });

  app.post<{
    Body: {
      id?: string;
      auditId: string;
      ref: string;
      pathologyCode: string;
      x?: number;
      y?: number;
      severity?: string;
      description?: string;
      quantity?: number;
    };
  }>('/', auth, async (req, reply) => {
    const { id, auditId, ref, pathologyCode, x, y, severity, description, quantity } = req.body ?? {};
    if (!auditId || !ref || !pathologyCode) {
      return reply.code(400).send({ error: 'Champs requis: auditId, ref, pathologyCode' });
    }
    const obsId = id ?? uuidv4();
    const user = (req as any).user as { id: string };
    const res = await query(
      `INSERT INTO observations
         (id, audit_id, ref, pathology_code, x, y, severity, description, quantity, created_by_client)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (id) DO NOTHING
       RETURNING *`,
      [obsId, auditId, ref, pathologyCode, x ?? null, y ?? null, severity ?? 'normal', description ?? '', quantity ?? 0, user.id]
    );
    return reply.code(201).send(res.rows[0] ?? { id: obsId, status: 'noop' });
  });

  app.patch<{
    Params: { id: string };
    Body: {
      ref?: string;
      pathologyCode?: string;
      x?: number;
      y?: number;
      severity?: string;
      description?: string;
      quantity?: number;
    };
  }>('/:id', auth, async (req, reply) => {
    const { ref, pathologyCode, x, y, severity, description, quantity } = req.body ?? {};
    const res = await query(
      `UPDATE observations SET
         ref            = COALESCE($2, ref),
         pathology_code = COALESCE($3, pathology_code),
         x              = COALESCE($4, x),
         y              = COALESCE($5, y),
         severity       = COALESCE($6, severity),
         description    = COALESCE($7, description),
         quantity       = COALESCE($8, quantity),
         updated_at     = now()
       WHERE id = $1
       RETURNING *`,
      [req.params.id, ref, pathologyCode, x, y, severity, description, quantity]
    );
    if (!res.rows[0]) return reply.code(404).send({ error: 'Observation introuvable' });
    return res.rows[0];
  });

  app.delete<{ Params: { id: string } }>('/:id', auth, async (req, reply) => {
    await query('DELETE FROM observations WHERE id = $1', [req.params.id]);
    return reply.code(204).send();
  });
};

export default observationRoutes;
