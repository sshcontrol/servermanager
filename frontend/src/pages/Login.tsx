import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { APP_VERSION } from "../version";
import Logo from "../components/Logo";
import "./Login.css";

const API_BASE = import.meta.env.VITE_API_URL || "";

declare global {
  interface Window {
    grecaptcha?: {
      getResponse: () => string;
      reset: () => void;
      render: (container: HTMLElement, params: { sitekey: string; theme?: string }) => number;
    };
  }
}

export default function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [smsCode, setSmsCode] = useState("");
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [needsTotp, setNeedsTotp] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [recaptchaSiteKey, setRecaptchaSiteKey] = useState<string | null>(null);
  const [googleOAuthEnabled, setGoogleOAuthEnabled] = useState(false);
  const recaptchaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/public/platform-settings`)
      .then((r) => (r.ok ? r.json() : {}))
      .then((s: { recaptcha_site_key?: string; google_oauth_client_id?: string }) => {
        const key = s?.recaptcha_site_key?.trim();
        if (key) setRecaptchaSiteKey(key);
        setGoogleOAuthEnabled(!!s?.google_oauth_client_id?.trim());
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    // HashRouter: query is in hash (#/login?error=...), not window.location.search
    const hash = window.location.hash || "";
    const qIdx = hash.indexOf("?");
    const search = qIdx >= 0 ? hash.slice(qIdx) : window.location.search;
    const params = new URLSearchParams(search);
    const err = params.get("error");
    if (err) setError(decodeURIComponent(err || ""));
  }, []);

  useEffect(() => {
    if (!recaptchaSiteKey || !recaptchaRef.current) return;
    const siteKey = recaptchaSiteKey;
    const container = recaptchaRef.current;
    const renderWidget = () => {
      if (window.grecaptcha && container) {
        try {
          window.grecaptcha.render(container, {
            sitekey: siteKey,
            theme: "dark",
          });
        } catch {}
      }
    };
    if (typeof window.grecaptcha !== "undefined") {
      renderWidget();
      return;
    }
    const cbName = "___recaptchaLoginCb";
    (window as unknown as Record<string, unknown>)[cbName] = renderWidget;
    const script = document.createElement("script");
    script.src = `https://www.google.com/recaptcha/api.js?onload=${cbName}&render=explicit`;
    script.async = true;
    document.head.appendChild(script);
    return () => {
      delete (window as unknown as Record<string, unknown>)[cbName];
    };
  }, [recaptchaSiteKey]);

  const isRecaptchaWidgetRendered = () =>
    recaptchaRef.current?.querySelector("iframe") != null;

  const needsVerification = needsTotp || pendingToken;

  const handleBack = () => {
    setNeedsTotp(false);
    setPendingToken(null);
    setTotpCode("");
    setSmsCode("");
    setError("");
    if (recaptchaSiteKey && window.grecaptcha) window.grecaptcha.reset();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    if (pendingToken && smsCode.length < 4) {
      setError("Enter the 4-digit code from your phone");
      setLoading(false);
      return;
    }
    if (needsTotp && totpCode.length < 6) {
      setError("Enter the 6-digit code from your authenticator app");
      setLoading(false);
      return;
    }
    try {
      let recaptchaToken: string | undefined;
      if (!pendingToken && recaptchaSiteKey && window.grecaptcha) {
        recaptchaToken = window.grecaptcha.getResponse();
        if (!recaptchaToken) {
          if (!isRecaptchaWidgetRendered()) {
            setError(
              "Captcha could not load. Please refresh the page. If you're on localhost or a custom domain, add it in Google reCAPTCHA admin."
            );
          } else {
            setError("Please complete the captcha verification");
          }
          setLoading(false);
          return;
        }
      }
      await login(
        username,
        password,
        needsTotp ? totpCode : undefined,
        recaptchaToken,
        pendingToken ? { pendingToken, smsCode } : undefined
      );
      if (recaptchaSiteKey && window.grecaptcha) window.grecaptcha.reset();
    } catch (err) {
      const smsErr = err as { requiresSms?: boolean; pendingToken?: string };
      if (smsErr.requiresSms && smsErr.pendingToken) {
        setPendingToken(smsErr.pendingToken);
        setSmsCode("");
        setNeedsTotp(false);
        setError("");
        setLoading(false);
        return;
      }
      const msg = err instanceof Error ? err.message : "Login failed";
      if (msg.toLowerCase().includes("totp") && msg.toLowerCase().includes("required")) {
        setNeedsTotp(true);
        setTotpCode("");
        setError("");
        setLoading(false);
        return;
      }
      if (
        recaptchaSiteKey &&
        (msg.includes("captcha") || msg.includes("Captcha")) &&
        !isRecaptchaWidgetRendered()
      ) {
        setError(
          "Captcha could not load. Please refresh the page. If you're on localhost or a custom domain, add it in Google reCAPTCHA admin."
        );
      } else {
        setError(msg);
      }
      if (recaptchaSiteKey && window.grecaptcha) window.grecaptcha.reset();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-backdrop" />
      <div className="login-content">
        <div className="login-card">
          <div className="login-card-header">
            <div className="login-logo">
              <Logo />
            </div>
            <p className="login-subtitle">Sign in to your account</p>
          </div>
          <form onSubmit={handleSubmit} className="login-form">
            {!needsVerification && (
              <>
                <div className="form-group">
                  {googleOAuthEnabled ? (
                    <a
                      href={`${API_BASE || ""}/api/auth/google?mode=login`}
                      className="login-google-btn"
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem",
                        padding: "0.75rem 1rem", borderRadius: 8, border: "1px solid rgba(255,255,255,0.2)",
                        background: "rgba(255,255,255,0.05)", color: "inherit", textDecoration: "none",
                        fontSize: "0.95rem", fontWeight: 500, cursor: "pointer", width: "100%",
                      }}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
                      Sign in with Google
                    </a>
                  ) : (
                    <div
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem",
                        padding: "0.75rem 1rem", borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)",
                        background: "rgba(255,255,255,0.02)", color: "var(--text-muted)", fontSize: "0.95rem",
                        opacity: 0.7, cursor: "not-allowed", width: "100%",
                      }}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
                      Sign in with Google
                    </div>
                  )}
                </div>
                <div style={{ textAlign: "center", padding: "0.5rem 0", fontSize: "0.85rem", color: "var(--text-muted)" }}>
                  {googleOAuthEnabled ? "— or sign in with username —" : "— sign in with username —"}
                </div>
              </>
            )}
            {!needsVerification ? (
              <>
                <div className="form-group">
                  <label htmlFor="username">Username</label>
                  <input
                    id="username"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                    autoComplete="username"
                    placeholder="Enter username"
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="password">Password</label>
                  <input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                    placeholder="Enter password"
                  />
                </div>
              </>
            ) : (
              <>
                <p style={{ fontSize: "0.95rem", color: "var(--text-muted)", marginBottom: "1rem" }}>
                  {needsTotp ? "Enter the 6-digit code from your authenticator app." : "Enter the 4-digit code sent to your phone."}
                </p>
                {needsTotp && (
                  <div className="form-group">
                    <label htmlFor="totp">2FA Code</label>
                    <input
                      id="totp"
                      type="text"
                      value={totpCode}
                      onChange={(e) => setTotpCode(e.target.value)}
                      placeholder="000000"
                      maxLength={6}
                      autoComplete="one-time-code"
                      required
                    />
                  </div>
                )}
                {pendingToken && (
                  <div className="form-group">
                    <label htmlFor="sms">SMS verification code</label>
                    <input
                      id="sms"
                      type="text"
                      value={smsCode}
                      onChange={(e) => setSmsCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
                      placeholder="0000"
                      maxLength={8}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      required
                    />
                  </div>
                )}
                <button type="button" className="btn-link" onClick={handleBack} style={{ marginBottom: "1rem" }}>
                  ← Back to sign in
                </button>
              </>
            )}
            {recaptchaSiteKey && !pendingToken && (
              <div className="form-group">
                <div ref={recaptchaRef} className="login-recaptcha" />
              </div>
            )}
            {error && <p className="error-msg login-error">{error}</p>}
            <button
              type="submit"
              className="primary login-submit"
              disabled={loading}
            >
              <span className="login-submit-text">
                {loading ? "Verifying…" : needsVerification ? "Verify & sign in" : "Sign in"}
              </span>
              <span className="login-submit-icon" aria-hidden>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" x2="3" y1="12" y2="12"/></svg>
              </span>
            </button>
            <div className="login-form-links">
              <Link to="/forgot-password">Forgot password?</Link>
              <Link to="/signup">Create account</Link>
            </div>
          </form>
        </div>
        <p className="login-footer">Version {APP_VERSION}</p>
      </div>
    </div>
  );
}
