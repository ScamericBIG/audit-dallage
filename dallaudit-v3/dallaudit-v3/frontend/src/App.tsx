import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/AuthContext';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import AuditPage from './pages/AuditPage';
import ObservationFormPage from './pages/ObservationFormPage';
import SyncPage from './pages/SyncPage';

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return (
    <div className="page-loader">
      <span className="spinner" />
    </div>
  );
  return user ? <>{children}</> : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/audits" element={<PrivateRoute><DashboardPage /></PrivateRoute>} />
          <Route path="/audits/:id" element={<PrivateRoute><AuditPage /></PrivateRoute>} />
          <Route path="/audits/:auditId/observations/:obsId" element={<PrivateRoute><ObservationFormPage /></PrivateRoute>} />
          <Route path="/sync" element={<PrivateRoute><SyncPage /></PrivateRoute>} />
          <Route path="*" element={<Navigate to="/audits" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
