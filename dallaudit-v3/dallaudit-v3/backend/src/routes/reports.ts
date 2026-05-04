import type { FastifyPluginAsync } from 'fastify';
import { generateAuditReport } from '../services/report.js';
import { query } from '../db.js';

const reportRoutes: FastifyPluginAsync = async (app) => {
  const auth = { preHandler: [app.authenticate] };

  // Generate and download PDF report
  app.get<{ Params: { auditId: string } }>(
    '/:auditId/pdf',
    auth,
    async (req, reply) => {
      try {
        const pdfBuffer = await generateAuditReport(req.params.auditId);
        const auditRes = await query<{ title: string }>('SELECT title FROM audits WHERE id = $1', [req.params.auditId]);
        const title = auditRes.rows[0]?.title ?? 'audit';
        const filename = `rapport-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`;

        return reply
          .header('Content-Type', 'application/pdf')
          .header('Content-Disposition', `attachment; filename="${filename}"`)
          .header('Content-Length', pdfBuffer.length)
          .send(pdfBuffer);
      } catch (err: any) {
        app.log.error({ err }, 'report generation failed');
        return reply.code(err.statusCode ?? 500).send({ error: err.message ?? 'Erreur génération rapport' });
      }
    }
  );
};

export default reportRoutes;
