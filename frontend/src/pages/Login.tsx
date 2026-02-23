import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { APP_VERSION } from "../version";
import Logo from "../components/Logo";
import "./Login.css";

export default function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(username, password, totpCode || undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
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
            <div className="form-group">
              <label htmlFor="totp">TOTP code <span className="login-optional">(if 2FA enabled)</span></label>
              <input
                id="totp"
                type="text"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value)}
                placeholder=""
                maxLength={6}
                autoComplete="one-time-code"
              />
            </div>
            <div className="form-group">
              <label htmlFor="sms-code">SMS verification <span className="login-optional">(coming soon)</span></label>
              <input
                id="sms-code"
                type="text"
                placeholder="SMS code"
                disabled
                readOnly
                aria-disabled="true"
                title="SMS verification will be available in a future update"
              />
            </div>
            {error && <p className="error-msg login-error">{error}</p>}
            <button
              type="submit"
              className="primary login-submit"
              disabled={loading}
            >
              <span className="login-submit-text">{loading ? "Signing in…" : "Sign in"}</span>
              <span className="login-submit-icon" aria-hidden>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" x2="3" y1="12" y2="12"/></svg>
              </span>
            </button>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: "1rem", fontSize: "0.875rem" }}>
              <Link to="/forgot-password" style={{ color: "var(--accent, #2dd4bf)", textDecoration: "none" }}>Forgot password?</Link>
              <Link to="/signup" style={{ color: "var(--accent, #2dd4bf)", textDecoration: "none" }}>Create account</Link>
            </div>
          </form>
        </div>
        <p className="login-footer">Version {APP_VERSION}</p>
      </div>
    </div>
  );
}
