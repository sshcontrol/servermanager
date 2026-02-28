import { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../api/client";
import Logo from "../components/Logo";
import LogoSpinner from "../components/LogoSpinner";
import { validatePassword, PASSWORD_HINT } from "../utils/password";
import "./Landing.css";

const API_BASE = import.meta.env.VITE_API_URL || "";

type Plan = {
  id: string;
  name: string;
  description?: string;
  price: number;
  currency: string;
  duration_label: string;
  max_users: number;
  max_servers: number;
  is_free: boolean;
};

type FAQItem = { q: string; a: string };
const faqs: FAQItem[] = [
  { q: "What is SSHCONTROL?", a: "SSHCONTROL is a centralised platform for managing SSH keys, server access, and user permissions across your entire infrastructure from a single dashboard." },
  { q: "How does SSHCONTROL work?", a: "Simply add your servers, invite users, and assign access permissions. SSHCONTROL syncs SSH keys and user accounts across all your servers automatically via a lightweight agent." },
  { q: "Is there a free plan?", a: "Yes! Our free plan lets you manage up to 3 users and 5 servers at no cost. You can upgrade anytime as your infrastructure grows." },
  { q: "What Linux distributions are supported?", a: "SSHCONTROL supports all major Linux distributions including Ubuntu, Debian, CentOS, RHEL, AlmaLinux, Rocky Linux, and more." },
  { q: "How secure is SSHCONTROL?", a: "Security is at our core. We use end-to-end encryption, two-factor authentication, IP whitelisting, and full audit logging. Your SSH keys never leave your servers." },
  { q: "Can I enforce SSH Two-Factor Authentication?", a: "Yes. You can enable 2FA for all SSH sessions across your infrastructure with one click, blocking 99.9% of automated attacks." },
  { q: "Do I need to install software on my servers?", a: "Yes, a lightweight agent is installed on each server you want to manage. It communicates via outbound HTTPS and has zero external dependencies." },
];

const features = [
  { icon: "key", title: "SSH Key Management", desc: "Create, upload, and rotate SSH keys with full lifecycle management. Enforce key strength policies automatically." },
  { icon: "users", title: "User & Group Management", desc: "Manage Linux users, groups, and SUDO permissions across all servers from a single dashboard." },
  { icon: "shield", title: "Two-Factor Authentication", desc: "Enable 2FA for SSH sessions across your entire infrastructure with a single toggle." },
  { icon: "activity", title: "Audit Logs & Monitoring", desc: "Track every action, login, and permission change. Export logs for compliance reporting." },
  { icon: "server", title: "Agent Deployment", desc: "Deploy our lightweight agent in seconds. Supports all major Linux distributions via standard packages." },
  { icon: "lock", title: "Easy to Scale", desc: "Upgrade your plan anytime as you grow. Add users and servers in seconds from your dashboard." },
];

const benefits = [
  { icon: "check-circle", title: "Ensure Compliance", desc: "Align with ISO 27001, SOC 2, PCI-DSS, and HIPAA. Meet GDPR and CCPA data privacy regulations effortlessly." },
  { icon: "zap", title: "Reduce IT Burden", desc: "Replace custom scripts and manual processes. Onboard new team members in minutes, not hours." },
  { icon: "eye", title: "Gain Visibility", desc: "See which servers meet security standards and who has access to what, all in real time." },
  { icon: "dollar", title: "Reduce Costs", desc: "Our flexible pricing grows with you. Start free and scale to enterprise without breaking the budget." },
  { icon: "cloud", title: "Multi-Cloud Ready", desc: "Works seamlessly across AWS, Azure, GCP, and on-premise infrastructure. No vendor lock-in." },
  { icon: "clock", title: "Save Time", desc: "Automate key rotation, user provisioning, and access revocation. Focus on building, not managing." },
];

const steps = [
  { num: "01", title: "Install the Agent", desc: "Run a single command on your servers. The lightweight agent registers automatically and appears in your dashboard." },
  { num: "02", title: "Add Your Team", desc: "Invite users and let them upload their SSH keys. SSHCONTROL enforces key strength requirements automatically." },
  { num: "03", title: "Assign Access", desc: "Create server groups and user groups. Assign permissions with granular SUDO controls." },
  { num: "04", title: "Stay Secure", desc: "SSHCONTROL syncs everything in real time. Enable 2FA, monitor sessions, and export audit logs." },
];

function FeatureIcon({ name }: { name: string }) {
  const icons: Record<string, JSX.Element> = {
    key: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>,
    users: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
    shield: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>,
    activity: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>,
    server: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="8" x="2" y="2" rx="2"/><rect width="20" height="8" x="2" y="14" rx="2"/><path d="M6 6v.01M6 18v.01"/></svg>,
    lock: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>,
    "check-circle": <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg>,
    zap: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>,
    eye: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>,
    dollar: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" x2="12" y1="2" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>,
    cloud: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>,
    clock: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  };
  return <span className="land-icon">{icons[name]}</span>;
}

function useReveal() {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const cb = useCallback((entries: IntersectionObserverEntry[]) => {
    entries.forEach(e => { if (e.isIntersecting) setVisible(true); });
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(cb, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, [cb]);
  return { ref, className: visible ? "land-reveal land-revealed" : "land-reveal" };
}

function Reveal({ children, delay }: { children: React.ReactNode; delay?: number }) {
  const { ref, className } = useReveal();
  return (
    <div ref={ref} className={className} style={delay ? { transitionDelay: `${delay}ms` } as React.CSSProperties : undefined}>
      {children}
    </div>
  );
}

function scrollTo(id: string) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ─── Auth Modal ─── */
function AuthModal({ defaultTab, onClose }: { defaultTab: "signin" | "signup"; onClose: () => void }) {
  const { login } = useAuth();
  const [tab, setTab] = useState(defaultTab);

  // Sign In state
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [smsCode, setSmsCode] = useState("");
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendSent, setResendSent] = useState(false);

  // Sign Up state
  const [companyName, setCompanyName] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [signupPass, setSignupPass] = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [signupError, setSignupError] = useState("");
  const [signupLoading, setSignupLoading] = useState(false);
  const [signupSuccess, setSignupSuccess] = useState("");
  const [showTerms, setShowTerms] = useState(false);
  const [termsText, setTermsText] = useState("");
  const [googleOAuthEnabled, setGoogleOAuthEnabled] = useState(false);
  const [recaptchaSiteKey, setRecaptchaSiteKey] = useState<string | null>(null);
  const recaptchaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/public/platform-settings`)
      .then((r) => (r.ok ? r.json() : {}))
      .then((s: { google_oauth_client_id?: string; recaptcha_site_key?: string }) => {
        setGoogleOAuthEnabled(!!s?.google_oauth_client_id?.trim());
        const key = s?.recaptcha_site_key?.trim();
        if (key) setRecaptchaSiteKey(key);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!recaptchaSiteKey || !recaptchaRef.current || tab !== "signin") return;
    const siteKey = recaptchaSiteKey;
    const container = recaptchaRef.current;
    const renderWidget = () => {
      if (typeof (window as unknown as { grecaptcha?: { render: (c: HTMLElement, p: { sitekey: string; theme?: string }) => number } }).grecaptcha !== "undefined" && container) {
        try {
          (window as unknown as { grecaptcha: { render: (c: HTMLElement, p: { sitekey: string; theme?: string }) => number } }).grecaptcha.render(container, { sitekey: siteKey, theme: "dark" });
        } catch { /* ignore */ }
      }
    };
    if (typeof (window as unknown as { grecaptcha?: unknown }).grecaptcha !== "undefined") {
      renderWidget();
      return;
    }
    const cbName = "___recaptchaAuthModalCb";
    (window as unknown as Record<string, unknown>)[cbName] = renderWidget;
    const script = document.createElement("script");
    script.src = `https://www.google.com/recaptcha/api.js?onload=${cbName}&render=explicit`;
    script.async = true;
    document.head.appendChild(script);
    return () => { delete (window as unknown as Record<string, unknown>)[cbName]; };
  }, [recaptchaSiteKey, tab]);

  useEffect(() => {
    if (showTerms && !termsText) {
      fetch(`${API_BASE}/api/public/terms`)
        .then(r => r.text())
        .then(setTermsText)
        .catch(() => setTermsText("Failed to load terms and conditions."));
    }
  }, [showTerms, termsText]);

  const isRecaptchaWidgetRendered = () => recaptchaRef.current?.querySelector("iframe") != null;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError("");
    setResendSent(false);
    if (pendingToken && smsCode.length < 4) {
      setLoginError("Enter the 4-digit code from your phone");
      return;
    }
    setLoginLoading(true);
    try {
      let recaptchaToken: string | undefined;
      if (!pendingToken && recaptchaSiteKey && (window as unknown as { grecaptcha?: { getResponse: () => string } }).grecaptcha) {
        recaptchaToken = (window as unknown as { grecaptcha: { getResponse: () => string } }).grecaptcha.getResponse();
        if (!recaptchaToken) {
          if (!isRecaptchaWidgetRendered()) {
            setLoginError("Captcha could not load. Please refresh. Add your domain in Google reCAPTCHA admin.");
          } else {
            setLoginError("Please complete the captcha verification");
          }
          setLoginLoading(false);
          return;
        }
      }
      await login(
        username,
        password,
        totpCode || undefined,
        recaptchaToken,
        pendingToken ? { pendingToken, smsCode } : undefined
      );
      if (recaptchaSiteKey && (window as unknown as { grecaptcha?: { reset: () => void } }).grecaptcha) {
        (window as unknown as { grecaptcha: { reset: () => void } }).grecaptcha.reset();
      }
      onClose();
    } catch (err) {
      const smsErr = err as { requiresSms?: boolean; pendingToken?: string };
      if (smsErr.requiresSms && smsErr.pendingToken) {
        setPendingToken(smsErr.pendingToken);
        setSmsCode("");
        setLoginError("");
        setLoginLoading(false);
        return;
      }
      setLoginError(err instanceof Error ? err.message : "Login failed");
      if (recaptchaSiteKey && (window as unknown as { grecaptcha?: { reset: () => void } }).grecaptcha) {
        (window as unknown as { grecaptcha: { reset: () => void } }).grecaptcha.reset();
      }
    } finally {
      setLoginLoading(false);
    }
  };

  const handleResendVerification = async () => {
    if (!username.trim()) return;
    setResendLoading(true);
    setResendSent(false);
    try {
      await api.post("/api/public/resend-verification", { email: username.trim() });
      setResendSent(true);
    } catch {
      setResendSent(true); // Same message for security
    } finally {
      setResendLoading(false);
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setSignupError("");
    const pwdErr = validatePassword(signupPass);
    if (pwdErr) { setSignupError(pwdErr); return; }
    if (signupPass !== confirmPass) { setSignupError("Passwords do not match"); return; }
    if (!acceptTerms) { setSignupError("You must accept the terms and conditions"); return; }
    setSignupLoading(true);
    try {
      const res = await api.post<{ message?: string }>("/api/public/signup", {
        company_name: companyName,
        full_name: fullName,
        email,
        password: signupPass,
        accept_terms: acceptTerms,
      });
      setSignupSuccess(res.message || "Account created successfully. You can now sign in.");
    } catch (err) {
      setSignupError(err instanceof Error ? err.message : "Signup failed");
    } finally {
      setSignupLoading(false);
    }
  };

  const switchToSignIn = () => {
    setSignupSuccess("");
    setTab("signin");
  };

  return (
    <div className="auth-overlay" onClick={onClose}>
      <div className="auth-modal" onClick={e => e.stopPropagation()}>
        <button className="auth-close" onClick={onClose} aria-label="Close">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>

        {/* Logo */}
        <div className="auth-logo"><Logo /></div>

        {/* Tab switcher */}
        <div className="auth-tabs">
          <button className={`auth-tab${tab === "signin" ? " active" : ""}`} onClick={() => setTab("signin")}>Sign In</button>
          <button className={`auth-tab${tab === "signup" ? " active" : ""}`} onClick={() => setTab("signup")}>Sign Up</button>
          <div className="auth-tab-indicator" style={{ left: tab === "signin" ? "0%" : "50%" }} />
        </div>

        {/* ─── Sign In ─── */}
        {tab === "signin" && (
          <form onSubmit={handleLogin} className="auth-form" autoComplete="on">
            <div className="auth-field">
              <label htmlFor="auth-user">Username or Email</label>
              <div className="auth-input-wrap">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                <input id="auth-user" type="text" value={username} onChange={e => setUsername(e.target.value)} required autoComplete="username" placeholder="your-username" />
              </div>
            </div>
            <div className="auth-field">
              <label htmlFor="auth-pass">Password</label>
              <div className="auth-input-wrap">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                <input id="auth-pass" type="password" value={password} onChange={e => setPassword(e.target.value)} required autoComplete="current-password" placeholder="********" />
              </div>
            </div>
            {!pendingToken && (
              <div className="auth-field">
                <label htmlFor="auth-totp">2FA Code <span className="auth-optional">(if enabled)</span></label>
                <div className="auth-input-wrap">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                  <input id="auth-totp" type="text" value={totpCode} onChange={e => setTotpCode(e.target.value)} maxLength={6} autoComplete="one-time-code" placeholder="000000" />
                </div>
              </div>
            )}
            {pendingToken && (
              <div className="auth-field">
                <label htmlFor="auth-sms">SMS verification code</label>
                <div className="auth-input-wrap">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                  <input id="auth-sms" type="text" value={smsCode} onChange={e => setSmsCode(e.target.value.replace(/\D/g, "").slice(0, 8))} placeholder="0000" maxLength={8} inputMode="numeric" autoComplete="one-time-code" />
                </div>
                <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>Enter the 4-digit code sent to your phone.</p>
              </div>
            )}
            {loginError && <p className="auth-error">{loginError}</p>}
            {loginError?.toLowerCase().includes("verify") && username.includes("@") && (
              <p className="auth-links" style={{ marginTop: "0.5rem" }}>
                <button type="button" className="auth-link-btn" onClick={handleResendVerification} disabled={resendLoading}>
                  {resendLoading ? "Sending..." : "Resend verification email"}
                </button>
                {resendSent && <span style={{ marginLeft: "0.5rem", color: "var(--text-secondary)", fontSize: "0.9rem" }}>Check your inbox.</span>}
              </p>
            )}
            {recaptchaSiteKey && (
              <div className="auth-field">
                <div ref={recaptchaRef} style={{ minHeight: 78, display: "flex", alignItems: "center", justifyContent: "flex-start" }} />
              </div>
            )}
            {googleOAuthEnabled && (
              <>
                <a
                  href={`${API_BASE || ""}/api/auth/google?mode=login`}
                  className="auth-google-btn"
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem",
                    padding: "0.75rem 1rem", borderRadius: 8, border: "1px solid rgba(255,255,255,0.2)",
                    background: "rgba(255,255,255,0.05)", color: "inherit", textDecoration: "none",
                    fontSize: "0.95rem", fontWeight: 500, marginBottom: "1rem",
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
                  Sign in with Google
                </a>
                <div style={{ textAlign: "center", padding: "0.25rem 0", fontSize: "0.85rem", color: "var(--text-muted)" }}>— or —</div>
              </>
            )}
            <button type="submit" className="auth-submit" disabled={loginLoading}>
              {loginLoading ? "Signing in..." : "Sign In"}
            </button>
            <div className="auth-links">
              <Link to="/forgot-password" onClick={onClose}>Forgot password?</Link>
            </div>
          </form>
        )}

        {/* ─── Sign Up ─── */}
        {tab === "signup" && !signupSuccess && (
          <div className="auth-form" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <label className="auth-terms">
              <input type="checkbox" checked={acceptTerms} onChange={e => setAcceptTerms(e.target.checked)} />
              <span>I agree to the{" "}
                <button type="button" className="auth-terms-link" onClick={() => setShowTerms(true)}>Terms and Conditions</button>
              </span>
            </label>
            {googleOAuthEnabled && (
              <>
                <a
                  href={acceptTerms ? `${API_BASE || ""}/api/auth/google?mode=signup&accept_terms=true` : "#"}
                  className="auth-google-btn"
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem",
                    padding: "0.75rem 1rem", borderRadius: 8, border: "1px solid rgba(255,255,255,0.2)",
                    background: "rgba(255,255,255,0.05)", color: "inherit", textDecoration: "none",
                    fontSize: "0.95rem", fontWeight: 500, marginBottom: "0.25rem",
                  }}
                  onClick={(e) => {
                    if (!acceptTerms) {
                      e.preventDefault();
                      setSignupError("You must accept the terms and conditions to sign up with Google");
                    }
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
                  Sign up with Google
                </a>
                <div style={{ textAlign: "center", padding: "0.25rem 0", fontSize: "0.85rem", color: "var(--text-muted)" }}>— or —</div>
              </>
            )}
          <form onSubmit={handleSignup} className="auth-form" autoComplete="on" style={{ marginTop: 0 }}>
            <div className="auth-row">
              <div className="auth-field">
                <label htmlFor="auth-company">Company Name</label>
                <div className="auth-input-wrap">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="16" height="20" x="4" y="2" rx="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01"/></svg>
                  <input id="auth-company" type="text" value={companyName} onChange={e => setCompanyName(e.target.value)} required placeholder="Acme Inc." />
                </div>
              </div>
              <div className="auth-field">
                <label htmlFor="auth-name">Full Name</label>
                <div className="auth-input-wrap">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                  <input id="auth-name" type="text" value={fullName} onChange={e => setFullName(e.target.value)} required placeholder="John Doe" />
                </div>
              </div>
            </div>
            <div className="auth-field">
              <label htmlFor="auth-email">Email Address</label>
              <div className="auth-input-wrap">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                <input id="auth-email" type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" placeholder="you@company.com" />
              </div>
            </div>
            <div className="auth-row">
              <div className="auth-field">
                <label htmlFor="auth-signup-pass">Password</label>
                <div className="auth-input-wrap">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                  <input id="auth-signup-pass" type="password" value={signupPass} onChange={e => setSignupPass(e.target.value)} required minLength={8} autoComplete="new-password" placeholder={PASSWORD_HINT} />
                </div>
              </div>
              <div className="auth-field">
                <label htmlFor="auth-confirm">Confirm</label>
                <div className="auth-input-wrap">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>
                  <input id="auth-confirm" type="password" value={confirmPass} onChange={e => setConfirmPass(e.target.value)} required minLength={8} autoComplete="new-password" placeholder="Repeat" />
                </div>
              </div>
            </div>
            {signupError && <p className="auth-error">{signupError}</p>}
            <button type="submit" className="auth-submit" disabled={signupLoading}>
              {signupLoading ? "Creating account..." : "Create Account"}
            </button>
          </form>
          </div>
        )}

        {/* ─── Sign Up Success ─── */}
        {tab === "signup" && signupSuccess && (
          <div className="auth-success">
            <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#2dd4bf" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            <p>{signupSuccess}</p>
            <button className="auth-submit" onClick={switchToSignIn}>Go to Sign In</button>
          </div>
        )}

        {/* ─── Terms Modal ─── */}
        {showTerms && (
          <div className="auth-terms-overlay" onClick={() => setShowTerms(false)}>
            <div className="auth-terms-modal" onClick={e => e.stopPropagation()}>
              <div className="auth-terms-header">
                <h3>Terms and Conditions</h3>
                <button onClick={() => setShowTerms(false)}>&times;</button>
              </div>
              <pre className="auth-terms-body">{termsText || "Loading..."}</pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Landing() {
  const { user, loading } = useAuth();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [navSolid, setNavSolid] = useState(false);
  const [authModal, setAuthModal] = useState<"signin" | "signup" | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/public/plans`).then(r => r.json()).then(setPlans).catch(() => {});
  }, []);

  useEffect(() => {
    const onScroll = () => setNavSolid(window.scrollY > 60);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (authModal) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [authModal]);

  if (loading) return <div className="app-loading"><LogoSpinner /></div>;
  if (user) return null;

  const navClick = (id: string) => {
    setMobileMenu(false);
    setTimeout(() => scrollTo(id), 10);
  };

  return (
    <div className="land">
      <div className="land-bg-fixed" />

      {/* ─── Navbar ─── */}
      <nav className={`land-nav${navSolid ? " land-nav-solid" : ""}`}>
        <div className="land-nav-inner">
          <a href="#home" onClick={e => { e.preventDefault(); navClick("home"); }} className="land-nav-brand"><Logo /></a>
          <button className="land-nav-hamburger" onClick={() => setMobileMenu(v => !v)} aria-label="Toggle menu">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" x2="21" y1="6" y2="6"/><line x1="3" x2="21" y1="12" y2="12"/><line x1="3" x2="21" y1="18" y2="18"/></svg>
          </button>
          <div className={`land-nav-links${mobileMenu ? " open" : ""}`}>
            <a href="#features" onClick={e => { e.preventDefault(); navClick("features"); }}>Features</a>
            <a href="#benefits" onClick={e => { e.preventDefault(); navClick("benefits"); }}>Benefits</a>
            <a href="#how-it-works" onClick={e => { e.preventDefault(); navClick("how-it-works"); }}>How It Works</a>
            <a href="#pricing" onClick={e => { e.preventDefault(); navClick("pricing"); }}>Plans</a>
            <a href="#faq" onClick={e => { e.preventDefault(); navClick("faq"); }}>FAQ</a>
            <a href="#contact" onClick={e => { e.preventDefault(); navClick("contact"); }}>Contact</a>
          </div>
          <div className="land-nav-actions">
            <button className="land-nav-panel" onClick={() => setAuthModal("signin")}>Panel</button>
          </div>
        </div>
      </nav>

      {/* ─── Hero ─── */}
      <section id="home" className="land-hero">
        <div className="land-container land-hero-content">
          <Reveal>
            <h1 className="land-hero-title">Centralised and Secure<br /><span>SSH Key Management</span></h1>
          </Reveal>
          <Reveal delay={120}>
            <p className="land-hero-sub">Automate and manage your users and SSH keys across your entire infrastructure from a single dashboard. Increase security, reduce costs, and stay compliant.</p>
          </Reveal>
          <Reveal delay={240}>
            <div className="land-hero-btns">
              <button onClick={() => setAuthModal("signup")} className="land-btn-primary">Start Free Today</button>
              <a href="#features" onClick={e => { e.preventDefault(); scrollTo("features"); }} className="land-btn-outline">Explore Features</a>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ─── Features ─── */}
      <section id="features" className="land-section">
        <div className="land-container">
          <Reveal>
            <h2 className="land-section-title">Powerful Features</h2>
            <p className="land-section-sub">Everything you need to manage server access at scale</p>
          </Reveal>
          <div className="land-features-grid">
            {features.map((f, i) => (
              <Reveal key={i} delay={i * 80}>
                <div className="land-feature-card">
                  <div className="land-feature-icon"><FeatureIcon name={f.icon} /></div>
                  <h3>{f.title}</h3>
                  <p>{f.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Benefits ─── */}
      <section id="benefits" className="land-section land-section-alt">
        <div className="land-container">
          <Reveal>
            <h2 className="land-section-title">Why Choose SSHCONTROL</h2>
            <p className="land-section-sub">Real results for modern infrastructure teams</p>
          </Reveal>
          <div className="land-benefits-grid">
            {benefits.map((b, i) => (
              <Reveal key={i} delay={i * 80}>
                <div className="land-benefit-card">
                  <div className="land-benefit-icon"><FeatureIcon name={b.icon} /></div>
                  <div>
                    <h3>{b.title}</h3>
                    <p>{b.desc}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ─── How It Works ─── */}
      <section id="how-it-works" className="land-section">
        <div className="land-container">
          <Reveal>
            <h2 className="land-section-title">How It Works</h2>
            <p className="land-section-sub">Get up and running in minutes, not days</p>
          </Reveal>
          <div className="land-steps">
            {steps.map((s, i) => (
              <Reveal key={i} delay={i * 100}>
                <div className="land-step">
                  <div className="land-step-num">{s.num}</div>
                  <h3>{s.title}</h3>
                  <p>{s.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Plans ─── */}
      {plans.length > 0 && (
        <section id="pricing" className="land-section land-section-alt">
          <div className="land-container">
            <Reveal>
              <h2 className="land-section-title">Simple, Transparent Pricing</h2>
              <p className="land-section-sub">Start free. Upgrade when you're ready.</p>
            </Reveal>
            <div className="land-plans-grid">
              {plans.map((p, i) => (
                <Reveal key={p.id} delay={i * 100}>
                  <div className={`land-plan-card${p.is_free ? " land-plan-featured" : ""}`}>
                    {p.is_free && <div className="land-plan-badge">Free</div>}
                    <h3>{p.name}</h3>
                    <div className="land-plan-price">
                      {p.is_free ? <span className="land-plan-amount">$0</span> : <><span className="land-plan-amount">${p.price}</span><span className="land-plan-period">/ {p.duration_label}</span></>}
                    </div>
                    {p.description && <p className="land-plan-desc">{p.description}</p>}
                    <ul className="land-plan-features">
                      <li>Up to <strong>{p.max_users}</strong> users</li>
                      <li>Up to <strong>{p.max_servers}</strong> servers</li>
                      <li>SSH Key Management</li>
                      <li>2FA Authentication</li>
                      <li>Audit Logs</li>
                    </ul>
                    <button onClick={() => setAuthModal("signup")} className={`land-plan-btn${p.is_free ? " land-plan-btn-primary" : ""}`}>
                      {p.is_free ? "Get Started Free" : "Choose Plan"}
                    </button>
                  </div>
                </Reveal>
              ))}
            </div>
            <p className="land-plans-cta"><Link to="/plans">View all plans &rarr;</Link></p>
          </div>
        </section>
      )}

      {/* ─── FAQ ─── */}
      <section id="faq" className="land-section">
        <div className="land-container land-faq-container">
          <Reveal>
            <h2 className="land-section-title">Frequently Asked Questions</h2>
            <p className="land-section-sub">Answers to the most common questions</p>
          </Reveal>
          <div className="land-faq-list">
            {faqs.map((f, i) => (
              <Reveal key={i} delay={i * 50}>
                <div className={`land-faq-item${openFaq === i ? " open" : ""}`}>
                  <button className="land-faq-q" onClick={() => setOpenFaq(openFaq === i ? null : i)}>
                    <span>{f.q}</span>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points={openFaq === i ? "18 15 12 9 6 15" : "6 9 12 15 18 9"}/></svg>
                  </button>
                  {openFaq === i && <div className="land-faq-a">{f.a}</div>}
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Contact ─── */}
      <section id="contact" className="land-section land-section-alt">
        <div className="land-container land-contact">
          <Reveal>
            <h2 className="land-section-title">Get In Touch</h2>
            <p className="land-section-sub">Have questions or need a custom plan? We'd love to hear from you.</p>
          </Reveal>
          <Reveal delay={100}>
            <div className="land-contact-card">
              <div className="land-contact-info">
                <div className="land-contact-row">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                  <a href="mailto:info@sshcontrol.com">info@sshcontrol.com</a>
                </div>
                <div className="land-contact-row">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                  <a href="https://sshcontrol.com" target="_blank" rel="noopener noreferrer">sshcontrol.com</a>
                </div>
              </div>
              <p className="land-contact-note">We typically respond within 24 hours on business days.</p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ─── CTA ─── */}
      <section className="land-cta">
        <div className="land-container">
          <Reveal>
            <h2>Ready to Secure Your Infrastructure?</h2>
            <p>Get SSHCONTROL connected and running in under 10 minutes. Our free plan means you can try it risk-free.</p>
            <button onClick={() => setAuthModal("signup")} className="land-btn-primary">Start Free Today</button>
          </Reveal>
        </div>
      </section>

      {/* ─── Footer ─── */}
      <footer className="land-footer">
        <div className="land-container land-footer-inner">
          <div className="land-footer-brand">
            <Logo />
            <p>Centralised SSH key and user management for Linux servers.</p>
          </div>
          <div className="land-footer-links">
            <div>
              <h4>Product</h4>
              <a href="#features" onClick={e => { e.preventDefault(); scrollTo("features"); }}>Features</a>
              <a href="#how-it-works" onClick={e => { e.preventDefault(); scrollTo("how-it-works"); }}>How It Works</a>
              <a href="#pricing" onClick={e => { e.preventDefault(); scrollTo("pricing"); }}>Pricing</a>
            </div>
            <div>
              <h4>Company</h4>
              <a href="#contact" onClick={e => { e.preventDefault(); scrollTo("contact"); }}>Contact</a>
              <a href="#faq" onClick={e => { e.preventDefault(); scrollTo("faq"); }}>FAQ</a>
            </div>
            <div>
              <h4>Account</h4>
              <Link to="/login" className="land-footer-link-btn" style={{ display: "inline-block", marginBottom: "0.25rem" }}>Sign In</Link>
              <button className="land-footer-link-btn" onClick={() => setAuthModal("signup")}>Sign Up</button>
            </div>
          </div>
        </div>
        <div className="land-footer-bottom">
          <div className="land-container">
            <span>&copy; {new Date().getFullYear()} SSHCONTROL. All rights reserved.</span>
            <span>Powered by <a href="https://devotel.com/" target="_blank" rel="noopener noreferrer">Devotel</a></span>
          </div>
        </div>
      </footer>

      {/* ─── Auth Modal ─── */}
      {authModal && <AuthModal defaultTab={authModal} onClose={() => setAuthModal(null)} />}
    </div>
  );
}
