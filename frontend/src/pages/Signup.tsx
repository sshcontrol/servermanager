import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import Logo from "../components/Logo";
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
            <div className="form-group">
              <label htmlFor="password">Password</label>
              <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required placeholder="Min 8 characters" minLength={8} autoComplete="new-password" />
            </div>
            <div className="form-group">
              <label htmlFor="confirmPassword">Confirm Password</label>
              <input id="confirmPassword" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required placeholder="Repeat password" autoComplete="new-password" />
            </div>

            <div className="form-group" style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem" }}>
              <input
                id="acceptTerms"
                type="checkbox"
                checked={acceptTerms}
                onChange={(e) => setAcceptTerms(e.target.checked)}
                style={{ width: "auto", marginTop: "0.2rem", accentColor: "#2dd4bf" }}
              />
              <label htmlFor="acceptTerms" style={{ fontSize: "0.875rem", lineHeight: 1.5 }}>
                I agree to the{" "}
                <button type="button" onClick={() => setShowTerms(true)} style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", textDecoration: "underline", padding: 0, font: "inherit" }}>
                  Terms and Conditions
                </button>
              </label>
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
