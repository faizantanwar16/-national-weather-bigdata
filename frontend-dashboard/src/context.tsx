import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { fetchMe, hasToken, login, logout } from "./api/client";
import type { AuthUser } from "./api/types";
import { enterDemo } from "./api/gateway";

interface Toast { id: number; msg: string; bad: boolean }
interface AuthApi { user: AuthUser | null; ready: boolean; signIn: (e: string, p: string) => Promise<void>; signInDemo: () => void; signOut: () => void }
const ToastCtx = createContext<(m: string, bad?: boolean) => void>(() => {});
const AuthCtx = createContext<AuthApi>({ user: null, ready: false, signIn: async () => {}, signInDemo: () => {}, signOut: () => {} });
export const useToast = () => useContext(ToastCtx);
export const useAuth = () => useContext(AuthCtx);

export function Providers({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(!hasToken());
  const push = useCallback((msg: string, bad = false) => { const id = Math.random(); setToasts((t) => [...t, { id, msg, bad }]); setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3800); }, []);
  useEffect(() => { if (hasToken()) fetchMe().then((r) => setUser(r.user)).catch(() => logout()).finally(() => setReady(true)); }, []);
  const signIn = async (email: string, pw: string) => {
    try { await login(email, pw); setUser((await fetchMe()).user); } catch (e) { if (e instanceof TypeError) { enterDemo(); setUser({ id: "demo", email, role: "admin" }); } else throw e; }
  };
  const signInDemo = () => { enterDemo(); setUser({ id: "demo", email: "demo@skywatch.local", role: "admin" }); };
  const signOut = () => { logout(); setUser(null); };
  return (
    <ToastCtx.Provider value={push}><AuthCtx.Provider value={{ user, ready, signIn, signInDemo, signOut }}>
      {children}
      <div className="toasts" role="status" aria-live="polite">{toasts.map((t) => <div key={t.id} className="toast" style={{ "--c": t.bad ? "var(--rose)" : "var(--teal)" } as React.CSSProperties}>{t.msg}</div>)}</div>
    </AuthCtx.Provider></ToastCtx.Provider>
  );
}
