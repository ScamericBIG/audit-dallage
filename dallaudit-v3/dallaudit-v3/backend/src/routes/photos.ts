import type { FastifyPluginAsync } from 'fastify';
import { savePhotoFromStream, deleteFile, getStorageStats } from '../services/photo-store.js';
import { pool } from '../db.js';

const photoRoutes: FastifyPluginAsync = async (app) => {
  const auth = { preHandler: [app.authenticate] };

  // Upload
  app.post<{ Params: { photoId: string }; Querystring: { obsId?: string } }>(
    '/:photoId',
    auth,
    async (req, reply) => {
      const { photoId } = req.params;
      if (!/^ph_[a-z0-9]{8,48}$/i.test(photoId)) {
        return reply.code(400).send({ error: 'photoId invalide' });
      }
      const part = await (req as any).file();
      if (!part) return reply.code(400).send({ error: 'Aucun fichier' });

      try {
        const stored = await savePhotoFromStream(photoId, part.mimetype, part.file);
        if (req.query.obsId) {
          await pool.query(
            `INSERT INTO photos (id, observation_id, url, bytes, sha256, mime_type)
             VALUES ($1,$2,$3,$4,$5,$6)
             ON CONFLICT (id) DO UPDATE SET url=EXCLUDED.url, bytes=EXCLUDED.bytes, sha256=EXCLUDED.sha256`,
            [photoId, req.query.obsId, stored.url, stored.bytes, stored.sha256, stored.mimeType]
          );
        }
        return reply.code(201).send(stored);
      } catch (err: any) {
        req.log.error({ err }, 'photo upload failed');
        return reply.code(err.statusCode ?? 500).send({ error: err.message ?? 'Erreur serveur' });
      }
    }
  );

  // Delete
  app.delete<{ Params: { photoId: string } }>('/:photoId', auth, async (req, reply) => {
    const row = await pool.query<{ url: string }>('SELECT url FROM photos WHERE id = $1', [req.params.photoId]);
    if (row.rowCount === 0) return reply.code(404).send({ error: 'Photo introuvable' });
    await deleteFile(row.rows[0].url);
    await pool.query('DELETE FROM photos WHERE id = $1', [req.params.photoId]);
    return reply.code(204).send();
  });

  // Stats
  app.get('/stats', auth, async () => getStorageStats());
};

export default photoRoutes;
