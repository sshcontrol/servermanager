import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import Logo from "../components/Logo";
import { validatePassword } from "../utils/password";
import PasswordField from "../components/PasswordField";
import Toggle from "../components/Toggle";
import "./Login.css";

const API_BASE = import.meta.env.VITE_API_URL || "";

export default function Signup() {
  const [companyName, setCompanyName] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [termsText, setTermsText] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [googleOAuthEnabled, setGoogleOAuthEnabled] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/api/public/platform-settings`)
      .then((r) => (r.ok ? r.json() : {}))
      .then((s: { google_oauth_client_id?: string }) => {
        setGoogleOAuthEnabled(!!s?.google_oauth_client_id?.trim());
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    // HashRouter: query is in hash (#/signup?error=...), not window.location.search
    const hash = window.location.hash || "";
    const qIdx = hash.indexOf("?");
    const search = qIdx >= 0 ? hash.slice(qIdx) : window.location.search;
    const params = new URLSearchParams(search);
    const err = params.get("error");
    if (err) setError(decodeURIComponent(err));
  }, []);

  useEffect(() => {
    if (showTerms && !termsText) {
      fetch(`${API_BASE}/api/public/terms`)
        .then((r) => r.text())
        .then(setTermsText)
        .catch(() => setTermsText("Failed to load terms and conditions."));
    }
  }, [showTerms, termsText]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const pwdErr = validatePassword(password);
    if (pwdErr) {
      setError(pwdErr);
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    if (!acceptTerms) {
      setError("You must accept the terms and conditions");
      return;
    }

    setLoading(true);
    try {
      const res = await api.post<{ message?: string }>("/api/public/signup", {
        company_name: companyName,
        full_name: fullName,
        email,
        password,
        accept_terms: acceptTerms,
      });
      setSuccessMessage(res.message || "");
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Signup failed");
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="login-page">
        <div className="login-backdrop" />
        <div className="login-content">
          <div className="login-card">
            <div className="login-card-header">
              <div className="login-logo"><Logo /></div>
              <p className="login-subtitle">Account Created!</p>
            </div>
            <div style={{ textAlign: "center", padding: "1rem 0" }}>
              <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#2dd4bf" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
              </div>
              <p style={{ color: "var(--text-secondary)", lineHeight: 1.6, marginBottom: "1.5rem" }}>
                {successMessage || `Account created successfully. You can now log in.`}
              </p>
              <Link to="/login" className="primary login-submit" style={{ textDecoration: "none", display: "inline-block" }}>
                Go to Login
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      <div className="login-backdrop" />
      <div className="login-content" style={{ maxWidth: 440 }}>
        <div className="login-card">
          <div className="login-card-header">
            <div className="login-logo"><Logo /></div>
            <p className="login-subtitle">Create your account</p>
          </div>
          <form onSubmit={handleSubmit} className="login-form">
            <div className="form-group" style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem" }}>
              <Toggle id="acceptTerms" checked={acceptTerms} onChange={setAcceptTerms} />
              <label htmlFor="acceptTerms" style={{ fontSize: "0.875rem", lineHeight: 1.5 }}>
                I agree to the{" "}
                <button type="button" onClick={() => setShowTerms(true)} style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", textDecoration: "underline", padding: 0, font: "inherit" }}>
                  Terms and Conditions
                </button>
              </label>
            </div>
            <div className="form-group">
              {googleOAuthEnabled ? (
                <a
                  href={acceptTerms ? `${API_BASE || ""}/api/auth/google?mode=signup&accept_terms=true` : "#"}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem",
                    padding: "0.75rem 1rem", borderRadius: 8, border: "1px solid rgba(255,255,255,0.2)",
                    background: "rgba(255,255,255,0.05)", color: "inherit", textDecoration: "none",
                    fontSize: "0.95rem", fontWeight: 500, cursor: "pointer", width: "100%",
                  }}
                  onClick={(e) => {
                    if (!acceptTerms) {
                      e.preventDefault();
                      setError("You must accept the terms and conditions to sign up with Google");
                    }
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
                  Sign up with Google
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
                  Sign up with Google
                </div>
              )}
            </div>
            <div style={{ textAlign: "center", padding: "0.5rem 0", fontSize: "0.85rem", color: "var(--text-muted)" }}>— or create with email —</div>
            <div className="form-group">
              <label htmlFor="companyName">Company Name</label>
              <input id="companyName" type="text" value={companyName} onChange={(e) => setCompanyName(e.target.value)} required placeholder="Your company name" />
            </div>
            <div className="form-group">
              <label htmlFor="fullName">Full Name</label>
              <input id="fullName" type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} required placeholder="Your full name" />
            </div>
            <div className="form-group">
              <label htmlFor="email">Email Address</label>
              <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@company.com" autoComplete="email" />
            </div>
            <PasswordField
              id="password"
              value={password}
              onChange={setPassword}
              label="Password"
              placeholder="Enter password"
              showRequirements={true}
              showStrength={true}
            />
            <div className="form-group">
              <label htmlFor="confirmPassword">Confirm Password</label>
              <input id="confirmPassword" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required placeholder="Repeat password" autoComplete="new-password" />
            </div>

            {error && <p className="error-msg login-error">{error}</p>}

            <button type="submit" className="primary login-submit" disabled={loading}>
              <span className="login-submit-text">{loading ? "Creating account..." : "Sign Up"}</span>
            </button>

            <p style={{ textAlign: "center", marginTop: "1rem", fontSize: "0.875rem", color: "var(--text-muted)" }}>
              Already have an account?{" "}
              <Link to="/login" style={{ color: "var(--accent)", textDecoration: "none" }}>Sign in</Link>
            </p>
          </form>
        </div>
      </div>

      {showTerms && (
        <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem" }}>
          <div onClick={() => setShowTerms(false)} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }} />
          <div style={{ position: "relative", background: "var(--surface, #122a42)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 16, padding: "2rem", maxWidth: 600, width: "100%", maxHeight: "80vh", overflow: "auto", color: "var(--text-secondary, #cbd5e1)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <h2 style={{ margin: 0, color: "var(--accent, #2dd4bf)" }}>Terms and Conditions</h2>
              <button onClick={() => setShowTerms(false)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: "1.5rem" }}>&times;</button>
            </div>
            <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: "0.85rem", lineHeight: 1.7 }}>
              {termsText || "Loading..."}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
