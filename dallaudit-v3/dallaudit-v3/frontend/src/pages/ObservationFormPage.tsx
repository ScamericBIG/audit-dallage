import { useState, useEffect, useRef, type ChangeEvent } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';

import { db } from '../sync/db';
import { syncEngine } from '../sync/queue';
import { compressAndStorePhoto, blobToObjectURL } from '../sync/photos';
import { showToast, useLiveQuery } from '../lib/useSync';
import { Topbar, ToastLayer } from '../components/Layout';
import type { Observation, Photo } from '../sync/db';

const PATHOLOGIES = [
  { code: 'FIS', label: 'Fissure' },
  { code: 'ECL', label: 'Éclat / Épaufrure' },
  { code: 'AFF', label: 'Affaissement' },
  { code: 'DEC', label: 'Décollement' },
  { code: 'TAS', label: 'Tassement différentiel' },
  { code: 'USU', label: 'Usure prématurée' },
  { code: 'HUM', label: 'Humidité / Remontée capillaire' },
  { code: 'FER', label: 'Ferraillage apparent' },
  { code: 'JOI', label: 'Joint dégradé' },
  { code: 'DAL', label: 'Dalle cassée' },
  { code: 'AUT', label: 'Autre' },
];

export default function ObservationFormPage() {
  const { auditId, obsId } = useParams<{ auditId: string; obsId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isNew = obsId === 'new';

  // Parse coordinates from URL (from plan click)
  const initX = searchParams.get('x') ? Number(searchParams.get('x')) : undefined;
  const initY = searchParams.get('y') ? Number(searchParams.get('y')) : undefined;

  const [form, setForm] = useState({
    ref: '',
    patho: 'FIS',
    sev: 'normal' as 'normal' | 'critical',
    desc: '',
    qty: '',
    x: initX,
    y: initY,
  });
  const [saving, setSaving] = useState(false);
  const [addingPhoto, setAddingPhoto] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

  // Load existing observation
  const obs = useLiveQuery(
    () => (isNew ? Promise.resolve(null) : db.observations.get(obsId!)),
    [obsId, isNew]
  );

  const photos = useLiveQuery(
    () => {
      if (!obs?.photoIds?.length) return Promise.resolve([]);
      return db.photos.where('id').anyOf(obs.photoIds).toArray();
    },
    [obs?.photoIds?.join(',')],
    []
  ) ?? [];

  useEffect(() => {
    if (obs && !isNew) {
      setForm({
        ref: obs.ref,
        patho: obs.patho,
        sev: obs.sev,
        desc: obs.desc,
        qty: obs.qty > 0 ? String(obs.qty) : '',
        x: obs.x,
        y: obs.y,
      });
    }
  }, [obs, isNew]);

  // Auto-generate ref for new observation
  useEffect(() => {
    if (!isNew) return;
    db.observations.where('auditId').equals(auditId!).count()
      .then(count => {
        const n = count + 1;
        setForm(f => ({ ...f, ref: `OBS-${String(n).padStart(3, '0')}` }));
      });
  }, [isNew, auditId]);

  const set = (k: keyof typeof form, v: unknown) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.ref.trim() || !form.patho) {
      showToast('Référence et pathologie requises', 'error');
      return;
    }
    setSaving(true);
    try {
      const now = Date.now();
      if (isNew) {
        const newObs: Observation = {
          id: crypto.randomUUID(),
          auditId: auditId!,
          ref: form.ref.trim(),
          patho: form.patho,
          sev: form.sev,
          desc: form.desc,
          qty: Number(form.qty) || 0,
          photoIds: [],
          x: form.x,
          y: form.y,
          createdAt: now,
          updatedAt: now,
          syncStatus: 'pending',
        };
        await db.observations.add(newObs);
        await syncEngine.enqueue('createObs', newObs.id, {
          auditId: newObs.auditId,
          ref: newObs.ref,
          patho: newObs.patho,
          x: newObs.x,
          y: newObs.y,
          sev: newObs.sev,
          desc: newObs.desc,
          qty: newObs.qty,
          createdAt: newObs.createdAt,
          updatedAt: newObs.updatedAt,
        });
        showToast('Observation créée', 'success');
        navigate(-1);
      } else {
        const updated: Partial<Observation> = {
          ref: form.ref.trim(),
          patho: form.patho,
          sev: form.sev,
          desc: form.desc,
          qty: Number(form.qty) || 0,
          x: form.x,
          y: form.y,
          updatedAt: now,
          syncStatus: 'pending',
        };
        await db.observations.update(obsId!, updated);
        await syncEngine.enqueue('updateObs', obsId!, {
          ref: updated.ref,
          patho: updated.patho,
          sev: updated.sev,
          desc: updated.desc,
          qty: updated.qty,
          x: updated.x,
          y: updated.y,
          updatedAt: now,
        });
        showToast('Modifications sauvegardées', 'success');
        navigate(-1);
      }
    } catch {
      showToast('Erreur lors de la sauvegarde', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!obsId || isNew) return;
    setSaving(true);
    try {
      await db.observations.delete(obsId);
      await syncEngine.enqueue('deleteObs', obsId, {});
      showToast('Observation supprimée', 'success');
      navigate(-1);
    } catch {
      showToast('Erreur lors de la suppression', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handlePhotoCapture = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const targetObsId = isNew ? null : obsId;
    if (!targetObsId) {
      showToast("Sauvegardez d'abord l'observation", 'warn');
      return;
    }
    setAddingPhoto(true);
    try {
      await compressAndStorePhoto(file, targetObsId);
      showToast('Photo ajoutée', 'success');
    } catch {
      showToast('Erreur lors de l'ajout de la photo', 'error');
    } finally {
      setAddingPhoto(false);
      if (photoInputRef.current) photoInputRef.current.value = '';
    }
  };

  const handleDeletePhoto = async (photoId: string) => {
    if (!obsId) return;
    await db.photos.delete(photoId);
    const current = await db.observations.get(obsId);
    if (current) {
      const photoIds = current.photoIds.filter(id => id !== photoId);
      await db.observations.update(obsId, { photoIds, updatedAt: Date.now(), syncStatus: 'pending' });
      await syncEngine.enqueue('deletePhoto', obsId, { photoId });
    }
  };

  return (
    <div className="screen">
      <Topbar title={isNew ? 'Nouvelle observation' : `Modifier ${form.ref}`} back />

      <div className="screen-body">
        {/* Conflict banner */}
        {obs?.syncStatus === 'conflict' && (
          <div className="conflict-banner">
            <h4>⚠ Conflit de synchronisation</h4>
            <p style={{ fontSize: 12, color: 'var(--ink-2)', margin: 0 }}>
              Cette observation a été modifiée par un autre appareil. Vos modifications locales sont conservées.
              Sauvegardez pour les imposer au serveur.
            </p>
          </div>
        )}

        {/* REF + SEVERITY */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12 }}>
          <div className="field">
            <label>Référence *</label>
            <input
              type="text"
              value={form.ref}
              onChange={e => set('ref', e.target.value.toUpperCase())}
              placeholder="OBS-001"
              style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}
            />
          </div>
          <div className="field">
            <label>Sévérité</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {(['normal', 'critical'] as const).map(s => (
                <label key={s} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14 }}>
                  <input
                    type="radio"
                    name="sev"
                    value={s}
                    checked={form.sev === s}
                    onChange={() => set('sev', s)}
                    style={{ accentColor: s === 'critical' ? 'var(--critical)' : 'var(--green)' }}
                  />
                  <span style={{ color: s === 'critical' ? 'var(--critical)' : 'var(--green)', fontWeight: 600 }}>
                    {s === 'critical' ? '🔴 Critique' : '🟢 Normal'}
                  </span>
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* PATHOLOGIE */}
        <div className="field">
          <label>Pathologie *</label>
          <select value={form.patho} onChange={e => set('patho', e.target.value)}>
            {PATHOLOGIES.map(p => (
              <option key={p.code} value={p.code}>{p.code} — {p.label}</option>
            ))}
          </select>
        </div>

        {/* DESCRIPTION */}
        <div className="field">
          <label>Description</label>
          <textarea
            value={form.desc}
            onChange={e => set('desc', e.target.value)}
            placeholder="Décrivez l'anomalie, son contexte, son étendue…"
            rows={4}
          />
        </div>

        {/* QUANTITÉ */}
        <div className="field">
          <label>Quantité (m²)</label>
          <input
            type="number"
            min="0"
            step="0.1"
            value={form.qty}
            onChange={e => set('qty', e.target.value)}
            placeholder="0.00"
          />
        </div>

        {/* PHOTOS */}
        {!isNew && (
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10, fontWeight: 600 }}>
              Photos ({photos.length})
            </div>
            <div className="photo-grid">
              {photos.map(photo => (
                <PhotoThumb key={photo.id} photo={photo} onDelete={() => handleDeletePhoto(photo.id)} />
              ))}
              <button
                className="photo-thumb-add"
                onClick={() => photoInputRef.current?.click()}
                disabled={addingPhoto}
              >
                {addingPhoto
                  ? <span className="spinner" style={{ width: 20, height: 20 }} />
                  : <>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
                      <circle cx="12" cy="13" r="4"/>
                    </svg>
                    Photo
                  </>
                }
              </button>
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handlePhotoCapture}
                style={{ display: 'none' }}
              />
            </div>
          </div>
        )}
        {isNew && (
          <div style={{ background: 'var(--warn-bg)', border: '1px solid #E8D090', borderRadius: 'var(--r-md)', padding: '10px 14px', fontSize: 13, color: 'var(--warn)', marginBottom: 20 }}>
            💡 Sauvegardez d'abord l'observation pour ajouter des photos.
          </div>
        )}

        {/* Coordinates display */}
        {(form.x !== undefined || form.y !== undefined) && (
          <div style={{ background: 'var(--bg-alt)', borderRadius: 'var(--r-md)', padding: '8px 12px', fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--ink-3)', marginBottom: 16 }}>
            📍 Position sur plan : X={form.x?.toFixed(3) ?? '—'} Y={form.y?.toFixed(3) ?? '—'}
          </div>
        )}

        {/* Actions */}
        <button className="btn btn-accent btn-lg" style={{ width: '100%', marginBottom: 12 }} onClick={handleSave} disabled={saving}>
          {saving ? <><span className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} /> Enregistrement…</> : (isNew ? 'Créer l\'observation' : 'Enregistrer')}
        </button>

        {!isNew && !confirmDelete && (
          <button className="btn btn-danger" style={{ width: '100%' }} onClick={() => setConfirmDelete(true)}>
            Supprimer cette observation
          </button>
        )}
        {!isNew && confirmDelete && (
          <div style={{ background: '#FDF0EB', border: '1px solid #F4C0A8', borderRadius: 'var(--r-lg)', padding: '14px' }}>
            <p style={{ fontSize: 14, color: 'var(--critical)', marginBottom: 12 }}>Confirmer la suppression ?</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-danger" onClick={handleDelete}>Supprimer</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(false)}>Annuler</button>
            </div>
          </div>
        )}
      </div>

      <ToastLayer />
    </div>
  );
}

function PhotoThumb({ photo, onDelete }: { photo: Photo; onDelete: () => void }) {
  const [url, setUrl] = useState<string>('');
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const u = blobToObjectURL(photo.thumbBlob, `thumb_${photo.id}`);
    setUrl(u);
  }, [photo]);

  return (
    <>
      <div className="photo-thumb" onClick={() => setFullscreen(true)}>
        {url && <img src={url} alt="" loading="lazy" />}
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          style={{
            position: 'absolute', top: 4, right: 4,
            background: 'rgba(0,0,0,0.6)', color: '#FFF',
            border: 'none', borderRadius: '50%', width: 22, height: 22,
            fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >✕</button>
        {photo.syncStatus !== 'synced' && (
          <div style={{
            position: 'absolute', bottom: 4, left: 4,
            background: 'rgba(0,0,0,0.6)', color: '#FFF',
            borderRadius: 4, fontSize: 9, padding: '2px 4px', fontFamily: 'var(--font-mono)',
          }}>
            {photo.syncStatus === 'pending' ? '⏳' : '✓'}
          </div>
        )}
      </div>
      {fullscreen && (
        <div
          onClick={() => setFullscreen(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)',
            zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <img
            src={blobToObjectURL(photo.fullBlob, `full_${photo.id}`)}
            alt=""
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
          />
        </div>
      )}
    </>
  );
}
