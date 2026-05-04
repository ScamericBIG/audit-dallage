import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAudits, createAudit } from '../sync/api';
import { Topbar, BottomNav, ToastLayer } from '../components/Layout';
import { showToast } from '../lib/useSync';
import { useAuth } from '../lib/AuthContext';

interface Audit {
  id: string;
  title: string;
  description?: string;
  status: string;
  site_name?: string;
  site_address?: string;
  obs_count: number;
  critical_count: number;
  updated_at: string;
  created_by_name?: string;
}

const STATUS_LABEL: Record<string, string> = {
  draft: 'Brouillon',
  in_progress: 'En cours',
  completed: 'Terminé',
};

const STATUS_CLASS: Record<string, string> = {
  draft: 'badge-draft',
  in_progress: 'badge-in-progress',
  completed: 'badge-completed',
};

export default function DashboardPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [audits, setAudits] = useState<Audit[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [creating, setCreating] = useState(false);

  const fetchAudits = async () => {
    try {
      const data = await getAudits();
      setAudits(data as Audit[]);
    } catch (e) {
      showToast('Impossible de charger les audits (hors-ligne ?)', 'warn');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAudits(); }, []);

  const handleCreate = async () => {
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
      const audit = await createAudit({ title: newTitle.trim() }) as Audit;
      showToast('Audit créé', 'success');
      setShowNewForm(false);
      setNewTitle('');
      navigate(`/audits/${audit.id}`);
    } catch {
      showToast('Erreur lors de la création', 'error');
    } finally {
      setCreating(false);
    }
  };

  const totalObs = audits.reduce((s, a) => s + a.obs_count, 0);
  const totalCrit = audits.reduce((s, a) => s + a.critical_count, 0);

  return (
    <div className="screen">
      <Topbar title="DallAudit" />

      <div className="screen-body">
        {/* Welcome + Stats */}
        <div style={{ marginBottom: 20 }}>
          <p style={{ color: 'var(--ink-3)', fontSize: 13, marginBottom: 16, fontFamily: 'var(--font-mono)' }}>
            BONJOUR, {(user?.name ?? '').toUpperCase()}
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 20 }}>
            {[
              { label: 'Audits', value: audits.length, color: 'var(--ink)' },
              { label: 'Observations', value: totalObs, color: 'var(--ink)' },
              { label: 'Critiques', value: totalCrit, color: 'var(--critical)' },
            ].map(stat => (
              <div key={stat.label} className="card" style={{ padding: '14px 12px', textAlign: 'center' }}>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 800, color: stat.color, lineHeight: 1 }}>{stat.value}</div>
                <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--ink-3)', marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{stat.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* New audit form */}
        {showNewForm && (
          <div className="card" style={{ marginBottom: 16 }}>
            <h3 style={{ marginBottom: 14 }}>Nouvel audit</h3>
            <div className="field">
              <label>Titre de l'audit</label>
              <input
                type="text"
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                placeholder="ex: Audit Zone B — Bâtiment 3"
                autoFocus
                onKeyDown={e => e.key === 'Enter' && handleCreate()}
              />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-accent" onClick={handleCreate} disabled={!newTitle.trim() || creating}>
                {creating ? 'Création…' : 'Créer'}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowNewForm(false)}>Annuler</button>
            </div>
          </div>
        )}

        {/* Audit list */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ fontSize: 14, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, color: 'var(--ink-3)' }}>
            Mes audits ({audits.length})
          </h2>
        </div>

        {loading ? (
          <div className="page-loader" style={{ height: 200 }}>
            <span className="spinner" />
            <span style={{ fontSize: 13 }}>Chargement…</span>
          </div>
        ) : audits.length === 0 ? (
          <div className="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 9h6M9 13h6M9 17h4" strokeLinecap="round"/>
            </svg>
            <p>Aucun audit pour l'instant.<br />Créez-en un pour commencer.</p>
          </div>
        ) : (
          <div className="card-grid" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {audits.map(audit => (
              <AuditCard key={audit.id} audit={audit} onClick={() => navigate(`/audits/${audit.id}`)} />
            ))}
          </div>
        )}
      </div>

      {/* FAB */}
      <button className="fab" onClick={() => setShowNewForm(true)} title="Nouvel audit">
        +
      </button>

      <BottomNav />
      <ToastLayer />
    </div>
  );
}

function AuditCard({ audit, onClick }: { audit: Audit; onClick: () => void }) {
  const date = new Date(audit.updated_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });

  return (
    <div className="card" style={{ cursor: 'pointer', padding: '16px' }} onClick={onClick}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <h3 style={{ fontSize: 16, flex: 1, paddingRight: 12, lineHeight: 1.3 }}>{audit.title}</h3>
        <span className={`badge ${STATUS_CLASS[audit.status] ?? 'badge-draft'}`}>
          {STATUS_LABEL[audit.status] ?? audit.status}
        </span>
      </div>

      {audit.site_name && (
        <p style={{ fontSize: 12, color: 'var(--ink-3)', margin: '0 0 10px', display: 'flex', alignItems: 'center', gap: 4 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5"/>
          </svg>
          {audit.site_name}
        </p>
      )}

      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>
          {audit.obs_count} obs.
        </span>
        {audit.critical_count > 0 && (
          <span className="badge badge-critical" style={{ fontSize: 11 }}>
            {audit.critical_count} critique{audit.critical_count > 1 ? 's' : ''}
          </span>
        )}
        <span style={{ fontSize: 11, color: 'var(--ink-3)', marginLeft: 'auto' }}>{date}</span>
      </div>
    </div>
  );
}
