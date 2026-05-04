import { useEffect, useState, useCallback } from 'react';
import { liveQuery } from 'dexie';
import { subscribeNetwork, getNetState, setManualOffline, type NetState } from '../sync/net';
import { syncEngine, type EngineSnapshot } from '../sync/queue';

export function useNetwork() {
  const [state, setState] = useState<NetState>(getNetState());
  useEffect(() => subscribeNetwork(setState), []);
  return { ...state, setManualOffline };
}

export function useSync() {
  const [snap, setSnap] = useState<EngineSnapshot>(syncEngine.getSnapshot());
  useEffect(() => syncEngine.subscribe(setSnap), []);
  return { ...snap, syncNow: useCallback(() => syncEngine.syncNow(), []) };
}

export function useLiveQuery<T>(query: () => T | Promise<T>, deps: unknown[] = [], initial?: T): T | undefined {
  const [value, setValue] = useState<T | undefined>(initial);
  useEffect(() => {
    const obs = liveQuery(query);
    const sub = obs.subscribe({ next: setValue, error: (e) => console.error('[liveQuery]', e) });
    return () => sub.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return value;
}

// ---- Toast system ----
export type ToastType = 'default' | 'success' | 'error' | 'warn';

interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

let toastListeners: ((toasts: Toast[]) => void)[] = [];
let toasts: Toast[] = [];
let toastCounter = 0;

function emitToasts() { for (const fn of toastListeners) fn([...toasts]); }

export function showToast(message: string, type: ToastType = 'default', duration = 3000) {
  const id = ++toastCounter;
  toasts = [...toasts, { id, message, type }];
  emitToasts();
  setTimeout(() => { toasts = toasts.filter(t => t.id !== id); emitToasts(); }, duration);
}

export function useToasts() {
  const [t, setT] = useState<Toast[]>([]);
  useEffect(() => {
    toastListeners.push(setT);
    return () => { toastListeners = toastListeners.filter(fn => fn !== setT); };
  }, []);
  return t;
}
