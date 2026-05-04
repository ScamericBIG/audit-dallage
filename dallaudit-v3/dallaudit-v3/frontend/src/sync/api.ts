import { getClientId } from './db';
import type { PendingMutation, Photo } from './db';

const API_BASE = import.meta.env.VITE_API_BASE ?? '/api';

export class ApiError extends Error {
  constructor(public kind: 'offline' | 'timeout' | 'server' | 'auth', msg: string, public status?: number) {
    super(msg);
    this.name = 'ApiError';
  }
}

function getToken(): string | null {
  return localStorage.getItem('dallaudit_token');
}

async function request<T>(path: string, init: RequestInit = {}, timeoutMs = 12000): Promise<T> {
  const clientId = await getClientId();
  const token = getToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        ...(init.headers ?? {}),
        'X-Client-Id': clientId,
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...(init.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      },
    });

    if (res.status === 401) throw new ApiError('auth', 'Non authentifié', 401);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new ApiError('server', `HTTP ${res.status}: ${text}`, res.status);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  } catch (err: unknown) {
    if (err instanceof ApiError) throw err;
    const e = err as Error;
    if (e.name === 'AbortError') throw new ApiError('timeout', `Timeout ${timeoutMs}ms`);
    throw new ApiError('offline', e.message ?? 'Réseau indisponible');
  } finally {
    clearTimeout(timer);
  }
}

// ---- Auth ----
export async function login(email: string, password: string): Promise<{ token: string; user: { id: string; name: string; email: string; role: string } }> {
  const res = await request<{ token: string; user: { id: string; name: string; email: string; role: string } }>(
    '/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }
  );
  localStorage.setItem('dallaudit_token', res.token);
  return res;
}

export function logout() { localStorage.removeItem('dallaudit_token'); }

export async function getMe(): Promise<{ id: string; name: string; email: string; role: string } | null> {
  if (!getToken()) return null;
  try { return await request('/auth/me'); } catch { return null; }
}

// ---- Audits ----
export const getAudits = () => request<unknown[]>('/audits');
export const getAudit = (id: string) => request<unknown>(`/audits/${id}`);
export const createAudit = (body: unknown) => request<unknown>('/audits', { method: 'POST', body: JSON.stringify(body) });
export const updateAudit = (id: string, body: unknown) => request<unknown>(`/audits/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
export const deleteAudit = (id: string) => request<void>(`/audits/${id}`, { method: 'DELETE' });
export const getAuditObservations = (id: string) => request<unknown[]>(`/audits/${id}/observations`);

// ---- Sync ----
export async function pingHealth(): Promise<boolean> {
  try { await request<{ ok: boolean }>('/health', { method: 'GET' }, 3500); return true; } catch { return false; }
}

export interface MutationResult {
  clientMutationId: string;
  obsId: string;
  status: 'applied' | 'conflict' | 'error' | 'noop';
  serverVersion?: Record<string, unknown>;
  error?: string;
}

export async function pushMutations(mutations: PendingMutation[]): Promise<{ serverTime: number; results: MutationResult[] }> {
  const clientId = await getClientId();
  return request('/sync/mutations', {
    method: 'POST',
    body: JSON.stringify({
      clientId,
      mutations: mutations.map(m => ({
        clientMutationId: m.clientMutationId,
        op: m.op, obsId: m.obsId, enqueuedAt: m.enqueuedAt, payload: m.payload,
      })),
    }),
  });
}

export async function pullDelta(sinceMs: number, auditId?: string): Promise<{
  serverTime: number;
  observations: unknown[];
  photos: unknown[];
}> {
  const q = `sinceMs=${sinceMs}${auditId ? `&auditId=${auditId}` : ''}`;
  return request(`/sync/pull?${q}`, { method: 'GET' });
}

export async function uploadPhoto(photo: Photo): Promise<{ url: string; bytes: number; sha256: string }> {
  const fd = new FormData();
  const file = new File([photo.fullBlob], `${photo.id}.jpg`, { type: photo.mimeType });
  fd.append('file', file);
  return request(`/photos/${photo.id}?obsId=${encodeURIComponent(photo.obsId)}`, { method: 'POST', body: fd }, 30000);
}

export async function deletePhotoRemote(photoId: string): Promise<void> {
  return request<void>(`/photos/${photoId}`, { method: 'DELETE' });
}

export async function generateReport(auditId: string): Promise<Blob> {
  const token = getToken();
  const res = await fetch(`${API_BASE}/reports/${auditId}/pdf`, {
    headers: token ? { 'Authorization': `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new ApiError('server', `Erreur rapport: ${res.status}`, res.status);
  return res.blob();
}

export { request };
