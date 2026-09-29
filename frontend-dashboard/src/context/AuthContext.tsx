// src/context/AuthContext.tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { fetchMe, login as apiLogin, logout as apiLogout, ApiError } from "../api/client";
import type { UserRole } from "../types";
import { fetchMe, login, logout, ApiError } from "../api/client";
interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  sessionExpired: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);

  useEffect(() => {
    const hasToken = sessionStorage.getItem("nwbdap_token");
    if (!hasToken) {
      setLoading(false);
      return;
    }
    fetchMe()
      .then((res) => setUser(res.user))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          apiLogout();
          setSessionExpired(true);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  async function login(email: string, password: string) {
    const result = await apiLogin(email, password);
    setUser({ id: "", email: result.email, role: result.role });
    setSessionExpired(false);
  }

  function logout() {
    apiLogout();
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, sessionExpired, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}