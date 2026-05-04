import PDFDocument from 'pdfkit';
import { query } from '../db.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_ROOT = path.resolve(__dirname, '../../../uploads');

const PATHOLOGIES: Record<string, string> = {
  FIS: 'Fissure',
  ECL: 'Éclat',
  AFF: 'Affaissement',
  DEC: 'Décollement',
  TAS: 'Tassement différentiel',
  USU: 'Usure prématurée',
  HUM: 'Humidité / Remontée',
  FER: 'Ferraillage apparent',
  JOI: 'Joint dégradé',
  DAL: 'Dalle cassée',
  AUT: 'Autre',
};

// Brand colors
const COLORS = {
  ink: '#1C1712',
  accent: '#C94E1A',
  green: '#2D7A4F',
  sand: '#B09060',
  bg: '#F0E9DC',
  critical: '#C94E1A',
  normal: '#2D7A4F',
  gray: '#8A7B6A',
};

export async function generateAuditReport(auditId: string): Promise<Buffer> {
  // Fetch data
  const [auditRes, obsRes] = await Promise.all([
    query(
      `SELECT a.*, s.name AS site_name, s.address AS site_address, u.name AS auditor_name
       FROM audits a
       LEFT JOIN sites s ON s.id = a.site_id
       LEFT JOIN users u ON u.id = a.created_by
       WHERE a.id = $1`,
      [auditId]
    ),
    query(
      `SELECT o.*, 
              ARRAY(SELECT json_build_object('id', p.id, 'url', p.url)
                    FROM photos p WHERE p.observation_id = o.id ORDER BY p.created_at) AS photos_detail
       FROM observations o WHERE o.audit_id = $1
       ORDER BY o.ref ASC, o.created_at ASC`,
      [auditId]
    ),
  ]);

  const audit = auditRes.rows[0];
  if (!audit) throw Object.assign(new Error('Audit introuvable'), { statusCode: 404 });
  const observations = obsRes.rows;

  // Stats
  const totalObs = observations.length;
  const criticalCount = observations.filter(o => o.severity === 'critical').length;
  const pathoStats: Record<string, number> = {};
  for (const o of observations) {
    pathoStats[o.pathology_code] = (pathoStats[o.pathology_code] ?? 0) + 1;
  }

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      info: {
        Title: `Rapport Audit — ${audit.title}`,
        Author: audit.auditor_name ?? 'DallAudit',
        Creator: 'DallAudit V3',
      },
    });

    const buffers: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    const W = doc.page.width - 100; // usable width
    const pageH = doc.page.height;

    // ===== COVER PAGE =====
    // Header band
    doc.rect(0, 0, doc.page.width, 140).fill(COLORS.ink);
    doc.fill('#FFFFFF').fontSize(28).font('Helvetica-Bold')
       .text('DALLAUDIT', 50, 45);
    doc.fill(COLORS.accent).fontSize(10).font('Helvetica')
       .text('RAPPORT D\'AUDIT — DALLAGE INDUSTRIEL', 50, 80);
    doc.fill('#FFFFFF').fontSize(9)
       .text(new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }), 50, 100);

    // Title block
    doc.fill(COLORS.ink).fontSize(22).font('Helvetica-Bold')
       .text(audit.title, 50, 170, { width: W });

    doc.moveDown(0.5);
    doc.fontSize(11).font('Helvetica').fill(COLORS.gray)
       .text(`Site : ${audit.site_name ?? 'Non renseigné'}`, { width: W });
    if (audit.site_address) {
      doc.fontSize(10).fill(COLORS.gray).text(audit.site_address, { width: W });
    }
    if (audit.description) {
      doc.moveDown(0.5).fontSize(11).fill(COLORS.ink).text(audit.description, { width: W });
    }

    // Divider
    doc.moveDown(1.5).moveTo(50, doc.y).lineTo(50 + W, doc.y).lineWidth(1).stroke(COLORS.sand);
    doc.moveDown(1);

    // Summary KPIs
    const kpiY = doc.y;
    const kpiW = W / 3;

    const drawKpi = (label: string, value: string, color: string, x: number) => {
      doc.rect(x, kpiY, kpiW - 10, 70).fill('#FAF6F0').stroke(COLORS.sand);
      doc.fill(color).fontSize(30).font('Helvetica-Bold').text(value, x + 10, kpiY + 8, { width: kpiW - 20, align: 'center' });
      doc.fill(COLORS.gray).fontSize(8).font('Helvetica').text(label, x + 10, kpiY + 45, { width: kpiW - 20, align: 'center' });
    };

    drawKpi('OBSERVATIONS TOTALES', String(totalObs), COLORS.ink, 50);
    drawKpi('CRITIQUES', String(criticalCount), COLORS.critical, 50 + kpiW);
    drawKpi('STATUT AUDIT', audit.status === 'completed' ? 'TERMINÉ' : 'EN COURS', COLORS.green, 50 + kpiW * 2);

    // Pathology breakdown
    doc.y = kpiY + 90;
    doc.fill(COLORS.ink).fontSize(12).font('Helvetica-Bold').text('RÉPARTITION PAR PATHOLOGIE', 50, doc.y);
    doc.moveDown(0.5);

    for (const [code, count] of Object.entries(pathoStats).sort(([, a], [, b]) => b - a)) {
      const label = PATHOLOGIES[code] ?? code;
      const pct = totalObs > 0 ? Math.round((count / totalObs) * 100) : 0;
      const barW = Math.round((W * pct) / 100);

      doc.fill(COLORS.gray).fontSize(9).font('Helvetica')
         .text(`${code} — ${label}`, 50, doc.y, { continued: true, width: 200 })
         .text(`${count} obs. (${pct}%)`, { align: 'right', width: W - 200 });

      const barY = doc.y + 2;
      doc.rect(50, barY, W, 6).fill('#E8DFD0');
      doc.rect(50, barY, barW || 4, 6).fill(COLORS.accent);
      doc.y = barY + 12;
      doc.moveDown(0.4);
    }

    // ===== OBSERVATIONS PAGES =====
    doc.addPage();

    // Page header
    const pageHeader = () => {
      doc.rect(0, 0, doc.page.width, 50).fill(COLORS.ink);
      doc.fill('#FFFFFF').fontSize(10).font('Helvetica-Bold')
         .text('LISTE DES OBSERVATIONS', 50, 18, { width: W / 2 });
      doc.fill(COLORS.accent).fontSize(9).font('Helvetica')
         .text(audit.title, 50 + W / 2, 20, { width: W / 2, align: 'right' });
      doc.y = 70;
    };
    pageHeader();

    // Table header
    const cols = [60, 110, 90, 60, W - 60 - 110 - 90 - 60];
    const colX = [50, 110, 220, 310, 370];
    const headers = ['REF', 'PATHOLOGIE', 'SÉVÉRITÉ', 'QTÉ', 'DESCRIPTION'];

    const drawTableHeader = () => {
      const hY = doc.y;
      doc.rect(50, hY, W, 20).fill('#2A2521');
      headers.forEach((h, i) => {
        doc.fill('#FFFFFF').fontSize(8).font('Helvetica-Bold')
           .text(h, colX[i] + 3, hY + 6, { width: cols[i] - 6 });
      });
      doc.y = hY + 22;
    };
    drawTableHeader();

    let rowAlt = false;
    for (const obs of observations) {
      const pathoLabel = PATHOLOGIES[obs.pathology_code] ?? obs.pathology_code;
      const photos = Array.isArray(obs.photos_detail) ? obs.photos_detail : [];
      const hasPhotos = photos.length > 0;

      // Estimate row height
      const descLines = Math.ceil((obs.description?.length ?? 0) / 55) || 1;
      const photoH = hasPhotos ? 90 : 0;
      const rowH = Math.max(24, descLines * 12 + 16) + photoH;

      // Page break check
      if (doc.y + rowH > pageH - 60) {
        doc.addPage();
        pageHeader();
        drawTableHeader();
        rowAlt = false;
      }

      const rY = doc.y;
      doc.rect(50, rY, W, rowH).fill(rowAlt ? '#FAF6F0' : '#FFFFFF');

      // Severity stripe
      doc.rect(50, rY, 4, rowH).fill(obs.severity === 'critical' ? COLORS.critical : COLORS.green);

      const textY = rY + 6;
      doc.fill(COLORS.ink).fontSize(9).font('Helvetica-Bold')
         .text(obs.ref, colX[0] + 6, textY, { width: cols[0] - 6 });

      doc.fill(COLORS.ink).fontSize(9).font('Helvetica')
         .text(pathoLabel, colX[1] + 3, textY, { width: cols[1] - 6 });

      const sevLabel = obs.severity === 'critical' ? 'CRITIQUE' : 'NORMAL';
      doc.fill(obs.severity === 'critical' ? COLORS.critical : COLORS.green)
         .fontSize(8).font('Helvetica-Bold')
         .text(sevLabel, colX[2] + 3, textY, { width: cols[2] - 6 });

      doc.fill(COLORS.ink).fontSize(9).font('Helvetica')
         .text(obs.quantity > 0 ? `${obs.quantity} m²` : '—', colX[3] + 3, textY, { width: cols[3] - 6 });

      doc.fill(COLORS.gray).fontSize(8).font('Helvetica')
         .text(obs.description || '—', colX[4] + 3, textY, { width: cols[4] - 6 });

      // Photos
      if (hasPhotos) {
        let photoX = colX[4] + 3;
        const photoY = rY + (rowH - photoH) + 4;
        for (const photo of photos.slice(0, 4)) {
          const photoPath = photo.url.replace(/^\/uploads\//, '');
          const abs = path.join(UPLOAD_ROOT, photoPath);
          if (existsSync(abs)) {
            try {
              doc.image(abs, photoX, photoY, { height: 80, fit: [80, 80] });
              photoX += 85;
            } catch {
              // skip unreadable image
            }
          }
        }
      }

      doc.y = rY + rowH + 2;
      rowAlt = !rowAlt;
    }

    // ===== FOOTER on last page =====
    doc.y = pageH - 80;
    doc.moveTo(50, doc.y).lineTo(50 + W, doc.y).lineWidth(0.5).stroke(COLORS.sand);
    doc.moveDown(0.5);
    doc.fill(COLORS.gray).fontSize(8).font('Helvetica')
       .text(
         `Rapport généré le ${new Date().toLocaleString('fr-FR')} — DallAudit V3 — ${totalObs} observations — ${criticalCount} critiques`,
         50,
         doc.y,
         { align: 'center', width: W }
       );

    doc.end();
  });
}
