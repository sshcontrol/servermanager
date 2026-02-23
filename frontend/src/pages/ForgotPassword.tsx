import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import Logo from "../components/Logo";
import "./Login.css";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await api.post("/api/public/forgot-password", { email });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
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
            <div className="login-logo"><Logo /></div>
            <p className="login-subtitle">Reset your password</p>
          </div>
          {sent ? (
            <div style={{ textAlign: "center", padding: "1rem 0" }}>
              <div style={{ marginBottom: "1rem" }}>
                <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#2dd4bf" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
              </div>
              <p style={{ color: "var(--text-secondary)", lineHeight: 1.6, marginBottom: "1.5rem" }}>
                If an account exists with <strong style={{ color: "var(--accent)" }}>{email}</strong>, we've sent a password reset link. Check your inbox.
              </p>
              <Link to="/login" className="primary login-submit" style={{ textDecoration: "none", display: "inline-block" }}>
                Back to Login
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="login-form">
              <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", marginBottom: "1rem", lineHeight: 1.5 }}>
                Enter your email address and we'll send you a link to reset your password.
              </p>
              <div className="form-group">
                <label htmlFor="email">Email Address</label>
                <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@company.com" autoComplete="email" />
              </div>
              {error && <p className="error-msg login-error">{error}</p>}
              <button type="submit" className="primary login-submit" disabled={loading}>
                <span className="login-submit-text">{loading ? "Sending..." : "Send Reset Link"}</span>
              </button>
              <p style={{ textAlign: "center", marginTop: "1rem", fontSize: "0.875rem", color: "var(--text-muted)" }}>
                <Link to="/login" style={{ color: "var(--accent)", textDecoration: "none" }}>Back to Login</Link>
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
