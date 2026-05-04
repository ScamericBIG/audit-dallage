import Dexie, { type Table } from 'dexie';

export type SyncStatus = 'synced' | 'pending' | 'conflict' | 'error';
export type Severity = 'normal' | 'critical';

export interface Observation {
  id: string;
  auditId: string;
  ref: string;
  patho: string;
  x?: number;
  y?: number;
  sev: Severity;
  desc: string;
  qty: number;
  photoIds: string[];
  createdAt: number;
  updatedAt: number;
  syncStatus: SyncStatus;
  serverUpdatedAt?: number;
  conflictWith?: Partial<Observation>;
}

export interface Photo {
  id: string;
  obsId: string;
  fullBlob: Blob;
  thumbBlob: Blob;
  mimeType: string;
  fullBytes: number;
  thumbBytes: number;
  origBytes: number;
  dims: { w: number; h: number };
  createdAt: number;
  syncStatus: SyncStatus;
  serverUrl?: string;
  sha256?: string;
}

export type MutationOp = 'createObs' | 'updateObs' | 'deleteObs' | 'pushPhoto' | 'deletePhoto';

export interface PendingMutation {
  id?: number;
  clientMutationId: string;
  op: MutationOp;
  obsId: string;
  payload: Record<string, unknown>;
  enqueuedAt: number;
  status: 'queued' | 'sending' | 'done' | 'error';
  retries: number;
  nextAttemptAt?: number;
  lastError?: string;
  doneAt?: number;
}

export interface MetaEntry { key: string; value: unknown; }

export class DallAuditDB extends Dexie {
  observations!: Table<Observation, string>;
  photos!: Table<Photo, string>;
  mutations!: Table<PendingMutation, number>;
  meta!: Table<MetaEntry, string>;

  constructor() {
    super('dallaudit_v3');
    this.version(1).stores({
      observations: 'id, auditId, ref, syncStatus, updatedAt',
      photos:       'id, obsId, syncStatus, createdAt',
      mutations:    '++id, clientMutationId, status, obsId, enqueuedAt',
      meta:         'key',
    });
  }
}

export const db = new DallAuditDB();

export async function getClientId(): Promise<string> {
  const existing = await db.meta.get('clientId');
  if (existing) return existing.value as string;
  const id = 'cli_' + crypto.randomUUID().replace(/-/g, '');
  await db.meta.put({ key: 'clientId', value: id });
  return id;
}

export async function getLastSyncAt(): Promise<number> {
  const m = await db.meta.get('lastSyncAt');
  return (m?.value as number) ?? 0;
}

export async function setLastSyncAt(ts: number) {
  await db.meta.put({ key: 'lastSyncAt', value: ts });
}
