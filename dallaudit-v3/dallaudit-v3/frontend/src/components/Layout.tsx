import { useNavigate, useLocation } from 'react-router-dom';
import { useNetwork, useSync, useToasts } from '../lib/useSync';
import { useAuth } from '../lib/AuthContext';

interface TopbarProps {
  title: string;
  back?: boolean;
  actions?: React.ReactNode;
}

export function Topbar({ title, back, actions }: TopbarProps) {
  const navigate = useNavigate();
  return (
    <div className="topbar">
      {back && (
        <button className="topbar-back" onClick={() => navigate(-1)} aria-label="Retour">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="20" height="20">
            <path d="M19 12H5M12 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
      <span className="topbar-title">{title}</span>
      <SyncBadgeMini />
      {actions}
    </div>
  );
}

function SyncBadgeMini() {
  const { online } = useNetwork();
  const { queuedCount, sendingCount } = useSync();
  const total = queuedCount + sendingCount;
  return (
    <span className={`sync-pill ${online ? (total > 0 ? 'sync-pill-pending' : 'sync-pill-online') : 'sync-pill-offline'}`} style={{ fontSize: 10 }}>
      {online
        ? (total > 0
          ? <><span className="dot-pulse" />{total}</>
          : <>✓ Sync</>)
        : <>✕ Hors-ligne</>
      }
    </span>
  );
}

export function BottomNav() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { logout } = useAuth();

  const items = [
    {
      label: 'Audits',
      path: '/audits',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" rx="2"/>
          <path d="M9 9h6M9 13h6M9 17h4" strokeLinecap="round"/>
        </svg>
      ),
    },
    {
      label: 'Sync',
      path: '/sync',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
          <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" strokeLinecap="round"/>
        </svg>
      ),
    },
    {
      label: 'Déconnexion',
      path: '#',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      ),
      action: logout,
    },
  ];

  return (
    <nav className="bottom-nav">
      {items.map(item => (
        <button
          key={item.label}
          className={`bottom-nav-item ${pathname.startsWith(item.path) && item.path !== '#' ? 'active' : ''}`}
          onClick={() => item.action ? item.action() : navigate(item.path)}
        >
          {item.icon}
          {item.label}
        </button>
      ))}
    </nav>
  );
}

export function ToastLayer() {
  const toasts = useToasts();
  return (
    <div className="toast-container">
      {toasts.map(t => (
        <div key={t.id} className={`toast toast-${t.type}`}>{t.message}</div>
      ))}
    </div>
  );
}
