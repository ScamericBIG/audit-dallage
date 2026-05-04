import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import authRoutes from './routes/auth.js';
import auditRoutes from './routes/audits.js';
import observationRoutes from './routes/observations.js';
import syncRoutes from './routes/sync.js';
import photoRoutes from './routes/photos.js';
import reportRoutes from './routes/reports.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
    transport: process.env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
  },
});

// ---- Plugins ----------------------------------------------------------------
await app.register(cors, {
  origin: process.env.FRONTEND_URL ?? 'http://localhost:5173',
  credentials: true,
});

await app.register(jwt, {
  secret: process.env.JWT_SECRET ?? 'dallaudit-dev-secret-change-in-production',
  sign: { expiresIn: '7d' },
});

await app.register(multipart, {
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
});

const uploadsDir = path.resolve(__dirname, '../../uploads');
await app.register(fastifyStatic, {
  root: uploadsDir,
  prefix: '/uploads/',
  maxAge: 30 * 24 * 60 * 60 * 1000,
  immutable: true,
  decorateReply: false,
});

// ---- Auth decorator ---------------------------------------------------------
app.decorate('authenticate', async (req: any, reply: any) => {
  try {
    await req.jwtVerify();
  } catch {
    reply.code(401).send({ error: 'Non authentifié' });
  }
});

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

// ---- Routes -----------------------------------------------------------------
await app.register(authRoutes, { prefix: '/api/auth' });
await app.register(syncRoutes, { prefix: '/api' });       // /api/health, /api/sync/*
await app.register(auditRoutes, { prefix: '/api/audits' });
await app.register(observationRoutes, { prefix: '/api/observations' });
await app.register(photoRoutes, { prefix: '/api/photos' });
await app.register(reportRoutes, { prefix: '/api/reports' });

// ---- Start ------------------------------------------------------------------
const PORT = Number(process.env.PORT ?? 3001);
try {
  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`\n🏗  DallAudit API démarré sur http://localhost:${PORT}\n`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
