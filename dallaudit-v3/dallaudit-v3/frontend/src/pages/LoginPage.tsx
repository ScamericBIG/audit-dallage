import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { login as apiLogin } from '../sync/api';
import { useAuth } from '../lib/AuthContext';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('admin@dallaudit.fr');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { token, user } = await apiLogin(email, password);
      login(user, token);
      navigate('/audits', { replace: true });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur de connexion');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100dvh',
      background: 'var(--bg)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px',
    }}>
      {/* Logo mark */}
      <div style={{
        width: 72, height: 72,
        background: 'var(--ink)',
        borderRadius: 18,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 24,
        boxShadow: 'var(--shadow-md)',
      }}>
        <span style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 800, color: '#FFF', letterSpacing: '-1px' }}>DA</span>
      </div>

      <h1 style={{ marginBottom: 4, textAlign: 'center' }}>DallAudit</h1>
      <p style={{ color: 'var(--ink-3)', fontSize: 13, marginBottom: 36, textAlign: 'center' }}>
        Audit de dallage industriel — terrain
      </p>

      <form onSubmit={handleSubmit} style={{ width: '100%', maxWidth: 360 }}>
        <div className="field">
          <label>Email</label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="vous@exemple.fr"
            required
            autoComplete="email"
          />
        </div>
        <div className="field">
          <label>Mot de passe</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="••••••••"
            required
            autoComplete="current-password"
          />
        </div>

        {error && (
          <div style={{
            background: '#FDF0EB', border: '1px solid #F4C0A8',
            borderRadius: 'var(--r-md)', padding: '10px 14px',
            fontSize: 13, color: 'var(--critical)', marginBottom: 16,
          }}>
            {error}
          </div>
        )}

        <button type="submit" className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={loading}>
          {loading
            ? <><span className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} /> Connexion…</>
            : 'Se connecter'}
        </button>
      </form>

      <p style={{ marginTop: 32, fontSize: 11, color: 'var(--ink-3)', textAlign: 'center', fontFamily: 'var(--font-mono)' }}>
        DALLAUDIT V3 — OFFLINE-FIRST PWA
      </p>
    </div>
  );
}
