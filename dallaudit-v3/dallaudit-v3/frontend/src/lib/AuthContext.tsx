import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { getMe, logout as apiLogout } from '../sync/api';

interface User { id: string; name: string; email: string; role: string; }
interface AuthCtx { user: User | null; loading: boolean; login: (u: User, token: string) => void; logout: () => void; }

const Ctx = createContext<AuthCtx>({ user: null, loading: true, login: () => {}, logout: () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getMe().then(u => { setUser(u ?? null); setLoading(false); });
  }, []);

  const login = (u: User, token: string) => {
    localStorage.setItem('dallaudit_token', token);
    setUser(u);
  };

  const logout = () => {
    apiLogout();
    setUser(null);
  };

  return <Ctx.Provider value={{ user, loading, login, logout }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
