import { db, getClientId, setLastSyncAt } from './db';
import type { PendingMutation, MutationOp, Observation } from './db';
import { pushMutations, uploadPhoto, pullDelta, ApiError, type MutationResult } from './api';
import { subscribeNetwork, type NetState } from './net';

type Listener = (snap: EngineSnapshot) => void;

export interface EngineSnapshot {
  queuedCount: number;
  sendingCount: number;
  errorCount: number;
  conflictCount: number;
  lastSyncAt: number | null;
  running: boolean;
  online: boolean;
}

const BACKOFF = [0, 2_000, 8_000, 30_000, 90_000, 300_000];

class SyncEngine {
  private online = false;
  private lastSyncAt: number | null = null;
  private snap: EngineSnapshot = { queuedCount: 0, sendingCount: 0, errorCount: 0, conflictCount: 0, lastSyncAt: null, running: false, online: false };
  private listeners = new Set<Listener>();
  private drainP: Promise<void> | null = null;

  start() {
    subscribeNetwork((s: NetState) => this.onNet(s));
    setInterval(() => { if (this.online) this.drain(); }, 5000);
  }

  async enqueue(op: MutationOp, obsId: string, payload: Record<string, unknown>): Promise<void> {
    const m: PendingMutation = {
      clientMutationId: crypto.randomUUID(),
      op, obsId, payload, enqueuedAt: Date.now(), status: 'queued', retries: 0,
    };
    await db.mutations.add(m);
    await this.refresh();
    if (this.online) this.drain();
  }

  async syncNow(): Promise<void> { if (this.online) return this.drain(); }

  subscribe(fn: Listener): () => void { this.listeners.add(fn); fn(this.snap); return () => this.listeners.delete(fn); }
  getSnapshot(): EngineSnapshot { return { ...this.snap }; }

  private onNet(s: NetState) {
    this.online = s.online;
    this.snap = { ...this.snap, online: s.online };
    this.emit();
    if (s.online) this.drain();
  }

  private drain(): Promise<void> {
    if (!this.drainP) this.drainP = this._drain().finally(() => { this.drainP = null; });
    return this.drainP;
  }

  private async _drain() {
    this.snap = { ...this.snap, running: true }; this.emit();
    try {
      await this.drainPhotos();
      await this.drainObs();
      this.lastSyncAt = Date.now();
      await setLastSyncAt(this.lastSyncAt);
    } catch (e) {
      console.warn('[sync] drain error', e);
    } finally {
      this.snap = { ...this.snap, running: false, lastSyncAt: this.lastSyncAt };
      await this.refresh();
    }
  }

  private async drainPhotos() {
    const now = Date.now();
    const muts = await db.mutations.where('status').anyOf('queued', 'error')
      .filter(m => m.op === 'pushPhoto' && (m.nextAttemptAt ?? 0) <= now).toArray();
    for (const m of muts) {
      await db.mutations.update(m.id!, { status: 'sending' });
      try {
        const photo = await db.photos.get(m.payload.photoId as string);
        if (!photo) { await db.mutations.update(m.id!, { status: 'done', doneAt: Date.now() }); continue; }
        const r = await uploadPhoto(photo);
        await db.photos.update(photo.id, { syncStatus: 'synced', serverUrl: r.url, sha256: r.sha256 });
        await this.done(m.id!);
      } catch (e) { await this.fail(m, e); }
    }
  }

  private async drainObs() {
    const now = Date.now();
    const muts = await db.mutations.where('status').anyOf('queued', 'error')
      .filter(m => ['createObs','updateObs','deleteObs','deletePhoto'].includes(m.op) && (m.nextAttemptAt ?? 0) <= now)
      .sortBy('enqueuedAt');
    if (!muts.length) return;
    for (const m of muts) await db.mutations.update(m.id!, { status: 'sending' });

    const BATCH = 20;
    for (let i = 0; i < muts.length; i += BATCH) {
      const batch = muts.slice(i, i + BATCH);
      try {
        const { results } = await pushMutations(batch);
        await this.applyResults(batch, results);
      } catch (e) {
        for (const m of batch) await this.fail(m, e);
        if (e instanceof ApiError && e.kind === 'offline') break;
      }
    }
  }

  private async applyResults(batch: PendingMutation[], results: MutationResult[]) {
    const byId = new Map(results.map(r => [r.clientMutationId, r]));
    for (const m of batch) {
      const r = byId.get(m.clientMutationId);
      if (!r) { await this.fail(m, new Error('Pas de réponse')); continue; }
      if (r.status === 'applied' || r.status === 'noop') {
        if (r.serverVersion && (m.op === 'createObs' || m.op === 'updateObs')) {
          const sv = r.serverVersion as Record<string, unknown>;
          await db.observations.update(m.obsId, { syncStatus: 'synced', serverUpdatedAt: serverMs(sv.updated_at) });
        }
        await this.done(m.id!);
      } else if (r.status === 'conflict') {
        if (r.serverVersion) {
          await db.observations.update(m.obsId, {
            syncStatus: 'conflict',
            conflictWith: normalizeObs(r.serverVersion as Record<string, unknown>),
          });
        }
        await db.mutations.update(m.id!, { status: 'error', lastError: 'Conflit détecté' });
      } else {
        await this.fail(m, new Error(r.error ?? 'Erreur serveur'));
      }
    }
  }

  private async done(id: number) {
    await db.mutations.update(id, { status: 'done', doneAt: Date.now() });
    setTimeout(() => db.mutations.delete(id).catch(() => {}), 60_000);
  }

  private async fail(m: PendingMutation, err: unknown) {
    const retries = (m.retries ?? 0) + 1;
    const msg = err instanceof Error ? err.message : String(err);
    const terminal = err instanceof ApiError && err.kind === 'server' && (err.status === 400 || err.status === 404);
    await db.mutations.update(m.id!, {
      status: 'error', lastError: msg, retries,
      nextAttemptAt: terminal ? undefined : Date.now() + (BACKOFF[Math.min(retries, BACKOFF.length - 1)] ?? 300_000),
    });
  }

  private async refresh() {
    const [q, s, e] = await Promise.all([
      db.mutations.where('status').equals('queued').count(),
      db.mutations.where('status').equals('sending').count(),
      db.mutations.where('status').equals('error').count(),
    ]);
    const c = await db.observations.where('syncStatus').equals('conflict').count();
    this.snap = { ...this.snap, queuedCount: q, sendingCount: s, errorCount: e, conflictCount: c };
    this.emit();
  }

  private emit() { for (const fn of this.listeners) fn({ ...this.snap }); }
}

function serverMs(t: unknown): number {
  if (typeof t === 'number') return t;
  if (typeof t === 'string') return new Date(t).getTime();
  return Date.now();
}

function normalizeObs(row: Record<string, unknown>): Partial<Observation> {
  return {
    id: row.id as string,
    ref: row.ref as string,
    patho: row.pathology_code as string,
    x: row.x ? Number(row.x) : undefined,
    y: row.y ? Number(row.y) : undefined,
    sev: row.severity as 'normal' | 'critical',
    desc: row.description as string,
    qty: Number(row.quantity ?? 0),
    updatedAt: serverMs(row.updated_at),
  };
}

export const syncEngine = new SyncEngine();
