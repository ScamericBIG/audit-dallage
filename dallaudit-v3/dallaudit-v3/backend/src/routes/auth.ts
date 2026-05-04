import type { FastifyPluginAsync } from 'fastify';
import bcrypt from 'bcryptjs';
import { query } from '../db.js';

const authRoutes: FastifyPluginAsync = async (app) => {
  // --- Login ----------------------------------------------------------------
  app.post<{ Body: { email: string; password: string } }>('/login', async (req, reply) => {
    const { email, password } = req.body ?? {};
    if (!email || !password) {
      return reply.code(400).send({ error: 'Email et mot de passe requis' });
    }
    const res = await query<{ id: string; email: string; name: string; role: string; password_hash: string }>(
      'SELECT id, email, name, role, password_hash FROM users WHERE email = $1',
      [email.toLowerCase().trim()]
    );
    const user = res.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return reply.code(401).send({ error: 'Identifiants incorrects' });
    }
    const token = app.jwt.sign({ id: user.id, email: user.email, name: user.name, role: user.role });
    return reply.send({
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
  });

  // --- Me -------------------------------------------------------------------
  app.get('/me', { preHandler: [app.authenticate] }, async (req) => {
    const payload = (req as any).user as { id: string; email: string; name: string; role: string };
    const res = await query<{ id: string; email: string; name: string; role: string }>(
      'SELECT id, email, name, role FROM users WHERE id = $1',
      [payload.id]
    );
    return res.rows[0] ?? null;
  });

  // --- Register (admin only in production, open in dev) --------------------
  app.post<{ Body: { email: string; password: string; name: string; role?: string } }>(
    '/register',
    async (req, reply) => {
      const { email, password, name, role = 'tech' } = req.body ?? {};
      if (!email || !password || !name) {
        return reply.code(400).send({ error: 'Champs requis manquants' });
      }
      if (password.length < 8) {
        return reply.code(400).send({ error: 'Mot de passe trop court (min 8 car.)' });
      }
      const hash = await bcrypt.hash(password, 10);
      try {
        const res = await query<{ id: string; email: string; name: string; role: string }>(
          `INSERT INTO users (email, password_hash, name, role)
           VALUES ($1, $2, $3, $4)
           RETURNING id, email, name, role`,
          [email.toLowerCase().trim(), hash, name, role]
        );
        const user = res.rows[0];
        const token = app.jwt.sign({ id: user.id, email: user.email, name: user.name, role: user.role });
        return reply.code(201).send({ token, user });
      } catch (err: any) {
        if (err.code === '23505') {
          return reply.code(409).send({ error: 'Cet email est déjà utilisé' });
        }
        throw err;
      }
    }
  );
};

export default authRoutes;
