import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { api } from "../api/client";

const IDLE_LOGOUT_MS = 2 * 60 * 60 * 1000; // 2 hours
const IDLE_THROTTLE_MS = 60_000; // Reset timer at most once per minute on activity

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
  sms_verification_enabled?: boolean;
  onboarding_completed: boolean;
  needs_initial_password?: boolean;
  needs_initial_username?: boolean;
  is_google_user?: boolean;
  is_tenant_owner?: boolean;
  tenant_id?: string | null;
  company_name?: string | null;
  created_at: string;
  roles: { id: string; name: string }[];
};

type AuthContextType = {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string, totpCode?: string, recaptchaToken?: string, smsPayload?: { pendingToken: string; smsCode: string }) => Promise<void>;
  logout: () => void;
  refreshUser: (rethrowOnError?: boolean) => Promise<void>;
  isAdmin: boolean;
  isPlatformSuperadmin: boolean;
};

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  // If there's no token, show landing immediately; only show loading when we might be logged in
  const [loading, setLoading] = useState(() => !!localStorage.getItem("access_token"));

  const refreshUser = useCallback(async (rethrowOnError = false) => {
    const token = localStorage.getItem("access_token");
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const me = await api.get<User>("/api/auth/me");
      setUser(me);
    } catch (err) {
      localStorage.removeItem("access_token");
      localStorage.removeItem("refresh_token");
      setUser(null);
      if (rethrowOnError) throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  const login = useCallback(
    async (
      username: string,
      password: string,
      totpCode?: string,
      recaptchaToken?: string,
      smsPayload?: { pendingToken: string; smsCode: string }
    ) => {
      const body: Record<string, unknown> = smsPayload
        ? { pending_token: smsPayload.pendingToken, sms_code: smsPayload.smsCode, recaptcha_token: recaptchaToken ?? null }
        : { username, password, totp_code: totpCode ?? null, recaptcha_token: recaptchaToken ?? null };
      const res = await api.post<{
        access_token?: string;
        refresh_token?: string;
        user_id?: string;
        username?: string;
        email?: string;
        requires_sms?: boolean;
        pending_token?: string;
      }>("/api/auth/login", body);
      if (res.requires_sms && res.pending_token) {
        throw { requiresSms: true, pendingToken: res.pending_token } as { requiresSms: boolean; pendingToken: string };
      }
      if (!res.access_token || !res.refresh_token) throw new Error("Login failed");
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

  // Idle logout: after 2 hours of no activity, log the user out
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastActivityRef = useRef<number>(Date.now());

  useEffect(() => {
    if (!user) return;

    const resetIdleTimer = () => {
      const now = Date.now();
      if (now - lastActivityRef.current < IDLE_THROTTLE_MS) return;
      lastActivityRef.current = now;
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(() => {
        logout();
        if (typeof window !== "undefined") window.location.href = "/";
      }, IDLE_LOGOUT_MS);
    };

    resetIdleTimer(); // Start timer on mount

    const events = ["mousedown", "mousemove", "keydown", "scroll", "touchstart"];
    events.forEach((ev) => window.addEventListener(ev, resetIdleTimer));

    return () => {
      events.forEach((ev) => window.removeEventListener(ev, resetIdleTimer));
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    };
  }, [user, logout]);

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
