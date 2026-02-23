import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { api } from "../api/client";

export type User = {
  id: string;
  email: string;
  username: string;
  full_name?: string | null;
  phone?: string | null;
  is_active: boolean;
  is_superuser: boolean;
  totp_enabled: boolean;
  email_verified: boolean;
  phone_verified: boolean;
  onboarding_completed: boolean;
  needs_initial_password?: boolean;
  needs_initial_username?: boolean;
  tenant_id?: string | null;
  company_name?: string | null;
  created_at: string;
  roles: { id: string; name: string }[];
};

type AuthContextType = {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string, totpCode?: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  isAdmin: boolean;
  isPlatformSuperadmin: boolean;
};

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  // If there's no token, show landing immediately; only show loading when we might be logged in
  const [loading, setLoading] = useState(() => !!localStorage.getItem("access_token"));

  const refreshUser = useCallback(async () => {
    const token = localStorage.getItem("access_token");
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const me = await api.get<User>("/api/auth/me");
      setUser(me);
    } catch {
      localStorage.removeItem("access_token");
      localStorage.removeItem("refresh_token");
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  const login = useCallback(
    async (username: string, password: string, totpCode?: string) => {
      const res = await api.post<{
        access_token: string;
        refresh_token: string;
        user_id: string;
        username: string;
        email: string;
      }>("/api/auth/login", {
        username,
        password,
        totp_code: totpCode ?? null,
      });
      localStorage.setItem("access_token", res.access_token);
      localStorage.setItem("refresh_token", res.refresh_token);
      await refreshUser();
    },
    [refreshUser]
  );

  const logout = useCallback(() => {
    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
    setUser(null);
  }, []);

  const isPlatformSuperadmin = user?.is_superuser === true && !user?.tenant_id;
  const isAdmin =
    !isPlatformSuperadmin &&
    (user?.is_superuser === true || user?.roles?.some((r) => r.name === "admin") === true);

  return (
    <AuthContext.Provider
      value={{ user, loading, login, logout, refreshUser, isAdmin, isPlatformSuperadmin }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
