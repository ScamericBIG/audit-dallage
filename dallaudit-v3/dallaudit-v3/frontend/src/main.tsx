import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { startNetworkMonitor } from './sync/net';
import { syncEngine } from './sync/queue';
import { showToast } from './lib/useSync';
import './styles/globals.css';
import App from './App';

// 1. Démarrer le moniteur réseau (heartbeat + online/offline events)
startNetworkMonitor();

// 2. Démarrer le moteur de sync (draine la queue quand le réseau revient)
syncEngine.start();

// 3. Enregistrer le Service Worker avec toast de mise à jour
const updateSW = registerSW({
  onNeedRefresh() {
    showToast('Nouvelle version disponible — rechargez pour mettre à jour', 'default', 8000);
  },
  onOfflineReady() {
    showToast('App prête à fonctionner hors ligne ✓', 'success');
  },
  onRegisterError(error) {
    console.warn('[sw] register error', error);
  },
});

// 4. Render React
const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// Expose pour debug
if (import.meta.env.DEV) {
  (window as Record<string, unknown>).__updateSW = updateSW;
}
