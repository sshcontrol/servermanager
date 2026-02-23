import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import Logo from "../components/Logo";
import "./Login.css";

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    if (!token) {
      setError("Invalid reset link");
      return;
    }
    setLoading(true);
    try {
      await api.post("/api/public/reset-password", { token, new_password: password });
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed");
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="login-page">
        <div className="login-backdrop" />
        <div className="login-content">
          <div className="login-card">
            <div className="login-card-header">
              <div className="login-logo"><Logo /></div>
              <p className="login-subtitle">Invalid Link</p>
            </div>
            <div style={{ textAlign: "center", padding: "1rem 0" }}>
              <p style={{ color: "#ef4444", marginBottom: "1.5rem" }}>No reset token found in the URL.</p>
              <Link to="/forgot-password" className="primary login-submit" style={{ textDecoration: "none", display: "inline-block" }}>
                Request New Link
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
      <div className="login-content">
        <div className="login-card">
          <div className="login-card-header">
            <div className="login-logo"><Logo /></div>
            <p className="login-subtitle">Set New Password</p>
          </div>
          {success ? (
            <div style={{ textAlign: "center", padding: "1rem 0" }}>
              <div style={{ marginBottom: "1rem" }}>
                <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#2dd4bf" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
              </div>
              <p style={{ color: "var(--text-secondary)", marginBottom: "1.5rem", lineHeight: 1.6 }}>
                Your password has been reset successfully.
              </p>
              <Link to="/login" className="primary login-submit" style={{ textDecoration: "none", display: "inline-block" }}>
                Go to Login
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="login-form">
              <div className="form-group">
                <label htmlFor="password">New Password</label>
                <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required placeholder="Min 8 characters" minLength={8} autoComplete="new-password" />
              </div>
              <div className="form-group">
                <label htmlFor="confirmPassword">Confirm Password</label>
                <input id="confirmPassword" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required placeholder="Repeat password" autoComplete="new-password" />
              </div>
              {error && <p className="error-msg login-error">{error}</p>}
              <button type="submit" className="primary login-submit" disabled={loading}>
                <span className="login-submit-text">{loading ? "Resetting..." : "Reset Password"}</span>
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
