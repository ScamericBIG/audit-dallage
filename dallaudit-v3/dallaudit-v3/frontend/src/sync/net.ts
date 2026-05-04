import { pingHealth } from './api';

type Listener = (state: NetState) => void;

export interface NetState {
  nativeOnline: boolean;
  heartbeatOk: boolean | null;
  manualOffline: boolean;
  online: boolean;
  lastHeartbeatAt: number | null;
}

const HEARTBEAT_MS         = 20_000;
const HEARTBEAT_OFFLINE_MS = 6_000;

const listeners = new Set<Listener>();
const state: NetState = {
  nativeOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
  heartbeatOk:  null,
  manualOffline: false,
  online: true,
  lastHeartbeatAt: null,
};

function recompute() {
  state.online = state.nativeOnline && state.heartbeatOk !== false && !state.manualOffline;
  for (const fn of listeners) fn({ ...state });
}

let hbTimer: ReturnType<typeof setTimeout> | null = null;

async function doHeartbeat() {
  if (!state.nativeOnline || state.manualOffline) {
    state.heartbeatOk = false;
    recompute();
    schedule();
    return;
  }
  const ok = await pingHealth();
  state.heartbeatOk = ok;
  if (ok) state.lastHeartbeatAt = Date.now();
  recompute();
  schedule();
}

function schedule() {
  if (hbTimer) clearTimeout(hbTimer);
  hbTimer = setTimeout(doHeartbeat, state.online ? HEARTBEAT_MS : HEARTBEAT_OFFLINE_MS);
}

export function startNetworkMonitor() {
  if (typeof window === 'undefined') return;
  window.addEventListener('online', () => { state.nativeOnline = true; recompute(); doHeartbeat(); });
  window.addEventListener('offline', () => { state.nativeOnline = false; state.heartbeatOk = false; recompute(); });
  setTimeout(doHeartbeat, 800);
}

export function setManualOffline(offline: boolean) {
  state.manualOffline = offline;
  if (!offline) doHeartbeat();
  else state.heartbeatOk = false;
  recompute();
}

export function subscribeNetwork(fn: Listener): () => void {
  listeners.add(fn);
  fn({ ...state });
  return () => listeners.delete(fn);
}

export function getNetState(): NetState { return { ...state }; }

export async function probeNow(): Promise<boolean> {
  await doHeartbeat();
  return state.online;
}
