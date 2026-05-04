import type { FastifyPluginAsync } from 'fastify';
import { query } from '../db.js';

const auditRoutes: FastifyPluginAsync = async (app) => {
  const auth = { preHandler: [app.authenticate] };

  // --- List audits ----------------------------------------------------------
  app.get('/', auth, async (req) => {
    const user = (req as any).user as { id: string; role: string };
    const res = await query(
      `SELECT a.id, a.title, a.description, a.status, a.plan_url,
              a.created_at, a.updated_at,
              s.name AS site_name, s.address AS site_address,
              u.name AS created_by_name,
              COUNT(DISTINCT o.id)::int AS obs_count,
              COUNT(DISTINCT CASE WHEN o.severity = 'critical' THEN o.id END)::int AS critical_count
       FROM audits a
       LEFT JOIN sites s ON s.id = a.site_id
       LEFT JOIN users u ON u.id = a.created_by
       LEFT JOIN observations o ON o.audit_id = a.id
       GROUP BY a.id, s.name, s.address, u.name
       ORDER BY a.updated_at DESC`
    );
    return res.rows;
  });

  // --- Get single audit -----------------------------------------------------
  app.get<{ Params: { id: string } }>('/:id', auth, async (req, reply) => {
    const res = await query(
      `SELECT a.id, a.title, a.description, a.status, a.plan_url,
              a.created_at, a.updated_at,
              s.id AS site_id, s.name AS site_name, s.address AS site_address,
              u.name AS created_by_name,
              COUNT(DISTINCT o.id)::int AS obs_count,
              COUNT(DISTINCT CASE WHEN o.severity = 'critical' THEN o.id END)::int AS critical_count
       FROM audits a
       LEFT JOIN sites s ON s.id = a.site_id
       LEFT JOIN users u ON u.id = a.created_by
       LEFT JOIN observations o ON o.audit_id = a.id
       WHERE a.id = $1
       GROUP BY a.id, s.id, s.name, s.address, u.name`,
      [req.params.id]
    );
    if (!res.rows[0]) return reply.code(404).send({ error: 'Audit introuvable' });
    return res.rows[0];
  });

  // --- Create audit ---------------------------------------------------------
  app.post<{ Body: { title: string; description?: string; siteId?: string } }>(
    '/',
    auth,
    async (req, reply) => {
      const user = (req as any).user as { id: string };
      const { title, description, siteId } = req.body ?? {};
      if (!title) return reply.code(400).send({ error: 'Titre requis' });
      const res = await query(
        `INSERT INTO audits (title, description, site_id, created_by, status)
         VALUES ($1, $2, $3, $4, 'draft')
         RETURNING *`,
        [title, description ?? null, siteId ?? null, user.id]
      );
      return reply.code(201).send(res.rows[0]);
    }
  );

  // --- Update audit ---------------------------------------------------------
  app.patch<{ Params: { id: string }; Body: { title?: string; description?: string; status?: string; planUrl?: string } }>(
    '/:id',
    auth,
    async (req, reply) => {
      const { title, description, status, planUrl } = req.body ?? {};
      const res = await query(
        `UPDATE audits SET
           title       = COALESCE($2, title),
           description = COALESCE($3, description),
           status      = COALESCE($4, status),
           plan_url    = COALESCE($5, plan_url),
           updated_at  = now()
         WHERE id = $1
         RETURNING *`,
        [req.params.id, title, description, status, planUrl]
      );
      if (!res.rows[0]) return reply.code(404).send({ error: 'Audit introuvable' });
      return res.rows[0];
    }
  );

  // --- Delete audit ---------------------------------------------------------
  app.delete<{ Params: { id: string } }>('/:id', auth, async (req, reply) => {
    await query('DELETE FROM audits WHERE id = $1', [req.params.id]);
    return reply.code(204).send();
  });

  // --- Observations for an audit --------------------------------------------
  app.get<{ Params: { id: string } }>('/:id/observations', auth, async (req) => {
    const res = await query(
      `SELECT o.*, 
              ARRAY(
                SELECT json_build_object('id', p.id, 'url', p.url, 'bytes', p.bytes)
                FROM photos p WHERE p.observation_id = o.id
                ORDER BY p.created_at
              ) AS photos_detail
       FROM observations o
       WHERE o.audit_id = $1
       ORDER BY o.ref ASC, o.created_at ASC`,
      [req.params.id]
    );
    return res.rows;
  });

  // --- Upload plan (floor plan image) ---------------------------------------
  app.post<{ Params: { id: string } }>('/:id/plan', auth, async (req, reply) => {
    const data = await (req as any).file();
    if (!data) return reply.code(400).send({ error: 'Aucun fichier' });
    // For simplicity, store in uploads/plans/
    const { savePhotoFromStream } = await import('../services/photo-store.js');
    const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[data.mimetype as string] ?? '.jpg';
    const planId = `plan_${req.params.id.replace(/-/g, '').slice(0, 8)}${ext}`;
    const stored = await savePhotoFromStream(planId, data.mimetype, data.file, 'plans');
    await query('UPDATE audits SET plan_url = $2 WHERE id = $1', [req.params.id, stored.url]);
    return reply.send({ planUrl: stored.url });
  });
};

export default auditRoutes;
