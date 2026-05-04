import { Topbar, BottomNav, ToastLayer } from '../components/Layout';
import { useNetwork, useSync, showToast, useLiveQuery } from '../lib/useSync';
import { setManualOffline } from '../sync/net';
import { db } from '../sync/db';

export default function SyncPage() {
  const { online, nativeOnline, heartbeatOk, manualOffline, lastHeartbeatAt } = useNetwork();
  const { queuedCount, sendingCount, errorCount, conflictCount, lastSyncAt, running, syncNow } = useSync();

  const mutations = useLiveQuery(() => db.mutations.orderBy('enqueuedAt').reverse().limit(30).toArray(), [], []) ?? [];
  const conflicts = useLiveQuery(() => db.observations.where('syncStatus').equals('conflict').toArray(), [], []) ?? [];

  const handleSyncNow = async () => {
    if (!online) { showToast('Hors ligne — impossible de synchroniser', 'warn'); return; }
    await syncNow();
    showToast('Synchronisation déclenchée', 'success');
  };

  return (
    <div className="screen">
      <Topbar title="Synchronisation" />

      <div className="screen-body">
        {/* Network status */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h3>Statut réseau</h3>
            <span className={`sync-pill ${online ? 'sync-pill-online' : 'sync-pill-offline'}`}>
              {online ? '● En ligne' : '○ Hors ligne'}
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
            {[
              { label: 'Réseau natif', ok: nativeOnline },
              { label: 'Serveur (heartbeat)', ok: heartbeatOk !== false },
              { label: 'Override manuel désactivé', ok: !manualOffline },
            ].map(item => (
              <div key={item.label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span style={{ color: 'var(--ink-2)' }}>{item.label}</span>
                <span style={{ color: item.ok ? 'var(--green)' : 'var(--critical)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                  {item.ok ? '✓ OK' : '✗ NON'}
                </span>
              </div>
            ))}
            {lastHeartbeatAt && (
              <div style={{ fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>
                Dernier heartbeat : {new Date(lastHeartbeatAt).toLocaleTimeString('fr-FR')}
              </div>
            )}
          </div>

          {/* Manual override */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>Mode hors-ligne forcé</span>
            <button
              className={`btn btn-sm ${manualOffline ? 'btn-accent' : 'btn-ghost'}`}
              onClick={() => setManualOffline(!manualOffline)}
            >
              {manualOffline ? 'Désactiver' : 'Activer'}
            </button>
          </div>
        </div>

        {/* Queue stats */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h3>File de sync</h3>
            <button className="btn btn-sm btn-primary" onClick={handleSyncNow} disabled={!online || running}>
              {running ? <><span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> Sync…</> : '↑ Sync maintenant'}
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
            {[
              { label: 'En attente', value: queuedCount, color: queuedCount > 0 ? 'var(--warn)' : 'var(--ink)' },
              { label: 'En envoi', value: sendingCount, color: 'var(--ink)' },
              { label: 'Erreurs', value: errorCount, color: errorCount > 0 ? 'var(--critical)' : 'var(--ink)' },
              { label: 'Conflits', value: conflictCount, color: conflictCount > 0 ? 'var(--critical)' : 'var(--ink)' },
            ].map(s => (
              <div key={s.label} style={{ textAlign: 'center' }}>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 22, color: s.color }}>{s.value}</div>
                <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--ink-3)', textTransform: 'uppercase' }}>{s.label}</div>
              </div>
            ))}
          </div>

          {lastSyncAt && (
            <p style={{ fontSize: 12, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)', margin: 0 }}>
              Dernière sync : {new Date(lastSyncAt).toLocaleString('fr-FR')}
            </p>
          )}
        </div>

        {/* Conflicts */}
        {conflicts.length > 0 && (
          <div className="card" style={{ marginBottom: 16 }}>
            <h3 style={{ color: 'var(--critical)', marginBottom: 10 }}>⚠ Conflits ({conflicts.length})</h3>
            {conflicts.map(obs => (
              <div key={obs.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--border-lt)' }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 13 }}>{obs.ref}</div>
                <p style={{ fontSize: 12, color: 'var(--ink-3)', margin: '4px 0 0' }}>
                  Conflit avec la version serveur. Ouvrez l'observation pour résoudre.
                </p>
              </div>
            ))}
          </div>
        )}

        {/* Recent mutations */}
        <div className="card">
          <h3 style={{ marginBottom: 12 }}>Journal des opérations</h3>
          {mutations.length === 0 ? (
            <p style={{ color: 'var(--ink-3)', fontSize: 13 }}>Aucune opération récente.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {mutations.map(m => (
                <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border-lt)' }}>
                  <span className={`badge badge-${m.status === 'done' ? 'synced' : m.status}`} style={{ fontSize: 10, flexShrink: 0 }}>
                    {m.status}
                  </span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-2)', flex: 1 }}>{m.op}</span>
                  <span style={{ fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>
                    {new Date(m.enqueuedAt).toLocaleTimeString('fr-FR')}
                  </span>
                  {m.retries > 0 && <span style={{ fontSize: 10, color: 'var(--warn)' }}>#{m.retries}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <BottomNav />
      <ToastLayer />
    </div>
  );
}
