import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { db } from '../sync/db';
import { getAudit, getAuditObservations, updateAudit, generateReport } from '../sync/api';
import { Topbar, BottomNav, ToastLayer } from '../components/Layout';
import { showToast, useLiveQuery } from '../lib/useSync';
import { syncEngine } from '../sync/queue';
import type { Observation } from '../sync/db';


const PATHO_LABELS: Record<string, string> = {
  FIS:'Fissure', ECL:'Éclat', AFF:'Affaissement', DEC:'Décollement',
  TAS:'Tassement', USU:'Usure', HUM:'Humidité', FER:'Ferraillage',
  JOI:'Joint dégradé', DAL:'Dalle cassée', AUT:'Autre',
};

type Tab = 'liste' | 'plan' | 'rapport';

export default function AuditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [audit, setAudit] = useState<Record<string, unknown> | null>(null);
  const [tab, setTab] = useState<Tab>('liste');
  const [filter, setFilter] = useState<'all' | 'critical' | 'pending'>('all');
  const [searchQ, setSearchQ] = useState('');
  const [generatingReport, setGeneratingReport] = useState(false);
  const planRef = useRef<HTMLDivElement>(null);

  // Live observations from IndexedDB
  const localObs = useLiveQuery(
    () => db.observations.where('auditId').equals(id ?? '').sortBy('updatedAt'),
    [id],
    []
  ) ?? [];

  // Remote observations (loaded once, merged into IDB)
  useEffect(() => {
    if (!id) return;
    getAudit(id).then(setAudit).catch(() => {});
    getAuditObservations(id).then(async (serverObs) => {
      for (const obs of (serverObs as Record<string, unknown>[])) {
        await db.observations.put({
          id: obs.id as string,
          auditId: obs.audit_id as string,
          ref: obs.ref as string,
          patho: obs.pathology_code as string,
          x: obs.x ? Number(obs.x) : undefined,
          y: obs.y ? Number(obs.y) : undefined,
          sev: (obs.severity ?? 'normal') as 'normal' | 'critical',
          desc: (obs.description ?? '') as string,
          qty: Number(obs.quantity ?? 0),
          photoIds: (obs.photo_ids ?? []) as string[],
          createdAt: new Date(obs.created_at as string).getTime(),
          updatedAt: new Date(obs.updated_at as string).getTime(),
          syncStatus: 'synced',
        });
      }
    }).catch(() => {});
  }, [id]);

  const filtered = localObs.filter(o => {
    if (filter === 'critical' && o.sev !== 'critical') return false;
    if (filter === 'pending' && o.syncStatus === 'synced') return false;
    if (searchQ && !o.ref.toLowerCase().includes(searchQ.toLowerCase()) &&
        !(PATHO_LABELS[o.patho] ?? o.patho).toLowerCase().includes(searchQ.toLowerCase()) &&
        !o.desc.toLowerCase().includes(searchQ.toLowerCase())) return false;
    return true;
  });

  const critCount = localObs.filter(o => o.sev === 'critical').length;
  const pendingCount = localObs.filter(o => o.syncStatus !== 'synced').length;

  const handleNewObs = () => navigate(`/audits/${id}/observations/new`);

  const handleReport = async () => {
    if (!id) return;
    setGeneratingReport(true);
    try {
      const blob = await generateReport(id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `rapport-audit-${id.slice(0, 8)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('Rapport téléchargé', 'success');
    } catch {
      showToast('Erreur lors de la génération du rapport', 'error');
    } finally {
      setGeneratingReport(false);
    }
  };

  const auditTitle = (audit?.title ?? 'Audit') as string;
  const planUrl = audit?.plan_url as string | undefined;

  return (
    <div className="screen">
      <Topbar
        title={auditTitle}
        back
        actions={
          <button
            className="btn btn-ghost btn-sm"
            onClick={handleReport}
            disabled={generatingReport}
            style={{ color: '#FFF', borderColor: 'rgba(255,255,255,0.3)', fontSize: 12 }}
          >
            {generatingReport ? '…' : '📄 PDF'}
          </button>
        }
      />

      {/* Tab bar */}
      <div style={{
        display: 'flex',
        background: 'var(--ink)',
        padding: '0 16px 10px',
        gap: 8,
        borderBottom: '1px solid rgba(255,255,255,0.1)',
      }}>
        {(['liste', 'plan', 'rapport'] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '6px 14px',
            borderRadius: 100,
            fontSize: 12,
            fontWeight: 600,
            fontFamily: 'var(--font-mono)',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            background: tab === t ? 'var(--accent)' : 'rgba(255,255,255,0.1)',
            color: '#FFF',
            border: 'none',
            cursor: 'pointer',
          }}>
            {t === 'liste' ? `Liste (${localObs.length})` : t === 'plan' ? 'Plan' : 'Rapport'}
          </button>
        ))}
      </div>

      <div className="screen-body">
        {/* KPI row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 16 }}>
          {[
            { label: 'Total', value: localObs.length },
            { label: 'Critiques', value: critCount, color: critCount > 0 ? 'var(--critical)' : undefined },
            { label: 'En attente', value: pendingCount, color: pendingCount > 0 ? 'var(--warn)' : undefined },
          ].map(k => (
            <div key={k.label} className="card" style={{ padding: '10px 8px', textAlign: 'center' }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800, color: k.color ?? 'var(--ink)' }}>{k.value}</div>
              <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--ink-3)', textTransform: 'uppercase' }}>{k.label}</div>
            </div>
          ))}
        </div>

        {tab === 'liste' && (
          <>
            {/* Search + filter */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              <input
                type="search"
                placeholder="Rechercher…"
                value={searchQ}
                onChange={e => setSearchQ(e.target.value)}
                style={{
                  flex: 1,
                  background: 'var(--surface)',
                  border: '1.5px solid var(--border-lt)',
                  borderRadius: 'var(--r-md)',
                  padding: '9px 14px',
                  fontSize: 14,
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
              {(['all', 'critical', 'pending'] as const).map(f => (
                <button key={f} onClick={() => setFilter(f)} className={`btn btn-sm ${filter === f ? 'btn-primary' : 'btn-ghost'}`} style={{ fontSize: 11, fontFamily: 'var(--font-mono)', padding: '5px 12px' }}>
                  {f === 'all' ? 'Tout' : f === 'critical' ? '🔴 Critiques' : '🟡 En attente'}
                </button>
              ))}
            </div>

            {filtered.length === 0 ? (
              <div className="empty-state">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
                </svg>
                <p>{localObs.length === 0 ? 'Aucune observation. Appuyez sur + pour en ajouter.' : 'Aucun résultat pour ce filtre.'}</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {filtered.map(obs => (
                  <ObsCard
                    key={obs.id}
                    obs={obs}
                    onClick={() => navigate(`/audits/${id}/observations/${obs.id}`)}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {tab === 'plan' && (
          <PlanTab planUrl={planUrl} observations={localObs} auditId={id!} onObsClick={(obsId) => navigate(`/audits/${id}/observations/${obsId}`)} />
        )}

        {tab === 'rapport' && (
          <ReportTab audit={audit} observations={localObs} onDownload={handleReport} generating={generatingReport} />
        )}
      </div>

      <button className="fab" onClick={handleNewObs} title="Nouvelle observation">+</button>
      <BottomNav />
      <ToastLayer />
    </div>
  );
}

function ObsCard({ obs, onClick }: { obs: Observation; onClick: () => void }) {
  const pathoLabel = PATHO_LABELS[obs.patho] ?? obs.patho;
  return (
    <div className="card fade-in" style={{ cursor: 'pointer', padding: '14px 16px' }} onClick={onClick}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <div style={{
          width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
          background: obs.sev === 'critical' ? 'var(--critical)' : 'var(--green)',
        }} />
        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 14, color: 'var(--ink)' }}>{obs.ref}</span>
        <span className="patho-pill">{obs.patho} — {pathoLabel}</span>
        <span className={`badge badge-${obs.syncStatus}`} style={{ marginLeft: 'auto', fontSize: 10 }}>
          {obs.syncStatus === 'synced' ? '✓' : obs.syncStatus === 'pending' ? '…' : obs.syncStatus === 'conflict' ? '⚠' : '✗'}
        </span>
      </div>
      {obs.desc && <p style={{ fontSize: 13, color: 'var(--ink-2)', margin: 0, lineClamp: 2 }}>{obs.desc}</p>}
      <div style={{ display: 'flex', gap: 12, marginTop: 6 }}>
        {obs.qty > 0 && <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--ink-3)' }}>{obs.qty} m²</span>}
        {obs.photoIds?.length > 0 && <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>📷 {obs.photoIds.length}</span>}
      </div>
    </div>
  );
}

function PlanTab({ planUrl, observations, auditId, onObsClick }: {
  planUrl?: string;
  observations: Observation[];
  auditId: string;
  onObsClick: (id: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [planClickMode, setPlanClickMode] = useState(false);
  const navigate = useNavigate();

  const handlePlanClick = async (e: React.MouseEvent<HTMLDivElement>) => {
    if (!planClickMode) return;
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width);
    const y = ((e.clientY - rect.top) / rect.height);
    setPlanClickMode(false);
    navigate(`/audits/${auditId}/observations/new?x=${x.toFixed(4)}&y=${y.toFixed(4)}`);
  };

  return (
    <div>
      {!planUrl ? (
        <div className="plan-no-plan card">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ opacity: 0.4 }}>
            <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9" strokeLinecap="round"/>
          </svg>
          <p>Aucun plan de sol. Uploadez un plan pour placer des observations sur la carte.</p>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const fd = new FormData();
              fd.append('file', file);
              try {
                const token = localStorage.getItem('dallaudit_token');
                const res = await fetch(`/api/audits/${auditId}/plan`, {
                  method: 'POST',
                  headers: token ? { 'Authorization': `Bearer ${token}` } : {},
                  body: fd,
                });
                if (res.ok) { showToast('Plan uploadé', 'success'); window.location.reload(); }
              } catch { showToast('Erreur upload plan', 'error'); }
            }}
          />
          <button className="btn btn-ghost" onClick={() => fileRef.current?.click()}>
            Uploader un plan
          </button>
        </div>
      ) : (
        <div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <button
              className={`btn ${planClickMode ? 'btn-accent' : 'btn-ghost'} btn-sm`}
              onClick={() => setPlanClickMode(!planClickMode)}
            >
              {planClickMode ? '🎯 Cliquez sur le plan…' : '+ Placer une observation'}
            </button>
          </div>
          <div
            className="plan-container"
            style={{ cursor: planClickMode ? 'crosshair' : 'default', height: 360 }}
            onClick={handlePlanClick}
          >
            <img src={planUrl} alt="Plan de sol" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'contain' }} />
            {observations.filter(o => o.x !== undefined && o.y !== undefined).map(o => (
              <div
                key={o.id}
                className="plan-marker"
                style={{ left: `${(o.x ?? 0) * 100}%`, top: `${(o.y ?? 0) * 100}%` }}
                onClick={(e) => { e.stopPropagation(); onObsClick(o.id); }}
              >
                <div className={`plan-marker-dot ${o.sev}`}>{o.ref.slice(-2)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ReportTab({ audit, observations, onDownload, generating }: {
  audit: Record<string, unknown> | null;
  observations: Observation[];
  onDownload: () => void;
  generating: boolean;
}) {
  const critCount = observations.filter(o => o.sev === 'critical').length;
  const pathoStats: Record<string, number> = {};
  for (const o of observations) pathoStats[o.patho] = (pathoStats[o.patho] ?? 0) + 1;

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginBottom: 4 }}>{audit?.title as string ?? '—'}</h3>
        <p style={{ color: 'var(--ink-3)', fontSize: 13 }}>{audit?.site_name as string ?? 'Site non renseigné'}</p>
        <hr className="divider" style={{ margin: '14px 0' }} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase', marginBottom: 2 }}>Observations</div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 24 }}>{observations.length}</div>
          </div>
          <div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase', marginBottom: 2 }}>Critiques</div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 24, color: critCount > 0 ? 'var(--critical)' : 'var(--ink)' }}>{critCount}</div>
          </div>
        </div>
      </div>

      {/* Patho breakdown */}
      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ fontSize: 13, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', color: 'var(--ink-3)', fontWeight: 600, marginBottom: 12 }}>
          Répartition par pathologie
        </h3>
        {Object.entries(pathoStats).sort(([,a],[,b]) => b-a).map(([code, count]) => (
          <div key={code} style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
              <span style={{ fontFamily: 'var(--font-mono)' }}>{code} — {PATHO_LABELS[code] ?? code}</span>
              <span style={{ color: 'var(--ink-3)' }}>{count}</span>
            </div>
            <div style={{ height: 6, background: 'var(--bg-alt)', borderRadius: 3 }}>
              <div style={{ height: '100%', borderRadius: 3, background: 'var(--accent)', width: `${Math.round(count / observations.length * 100)}%` }} />
            </div>
          </div>
        ))}
      </div>

      <button className="btn btn-accent btn-lg" style={{ width: '100%' }} onClick={onDownload} disabled={generating}>
        {generating
          ? <><span className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} /> Génération…</>
          : '📄 Télécharger le rapport PDF'}
      </button>
    </div>
  );
}
