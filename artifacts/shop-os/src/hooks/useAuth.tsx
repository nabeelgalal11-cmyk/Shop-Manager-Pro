import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";

export interface AuthUser {
  id: number;
  username: string;
  firstName: string;
  lastName: string;
  email: string | null;
  role: string;
  roles: string[];
  active: boolean;
}

export type Resource = string;
export type Action = "view" | "create" | "edit" | "delete" | "print";

interface AuthState {
  user: AuthUser | null;
  permissions: Set<string>;
  loading: boolean;
}

interface AuthContextValue extends AuthState {
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  can: (resource: Resource, action: Action) => boolean;
  isAdmin: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const ME_URL = "/api/auth/me";
const LOGIN_URL = "/api/auth/login";
const LOGOUT_URL = "/api/auth/logout";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    permissions: new Set(),
    loading: true,
  });

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(ME_URL, { credentials: "include" });
      if (!r.ok) {
        setState({ user: null, permissions: new Set(), loading: false });
        return;
      }
      const data = await r.json();
      setState({
        user: data.user,
        permissions: new Set(data.permissions || []),
        loading: false,
      });
    } catch {
      setState({ user: null, permissions: new Set(), loading: false });
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const login = useCallback(async (username: string, password: string) => {
    const r = await fetch(LOGIN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ username, password }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.error || "Login failed");
    }
    const data = await r.json();
    setState({
      user: data.user,
      permissions: new Set(data.permissions || []),
      loading: false,
    });
  }, []);

  const logout = useCallback(async () => {
    await fetch(LOGOUT_URL, { method: "POST", credentials: "include" });
    setState({ user: null, permissions: new Set(), loading: false });
  }, []);

  const isAdmin = !!state.user?.roles?.includes("admin");

  const can = useCallback(
    (resource: Resource, action: Action): boolean => {
      if (!state.user) return false;
      if (isAdmin) return true;
      return state.permissions.has(`${resource}:${action}`);
    },
    [state.user, state.permissions, isAdmin],
  );

  return (
    <AuthContext.Provider value={{ ...state, login, logout, refresh, can, isAdmin }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export function usePerm(resource: Resource, action: Action): boolean {
  const { can } = useAuth();
  return can(resource, action);
}
