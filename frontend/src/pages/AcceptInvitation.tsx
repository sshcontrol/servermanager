import { useState, useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../contexts/AuthContext";
import Logo from "../components/Logo";
import "./Login.css";

const API_BASE = import.meta.env.VITE_API_URL || "";

type InviteInfo = {
  email: string;
  company_name: string;
  invited_by: string | null;
  role: string;
};

export default function AcceptInvitation() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { refreshUser } = useAuth();
  const token = params.get("token") || "";
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(true);
  const [infoError, setInfoError] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!token) {
      setInfoError("No invitation token found.");
      setLoadingInfo(false);
      return;
    }
    fetch(`${API_BASE}/api/public/invitation?token=${encodeURIComponent(token)}`)
      .then((r) => {
        if (!r.ok) return r.json().then((d) => { throw new Error(d.detail || "Invalid invitation"); });
        return r.json();
      })
      .then(setInfo)
      .catch((err) => setInfoError(err.message || "Invalid invitation"))
      .finally(() => setLoadingInfo(false));
  }, [token]);

  const handleAccept = async () => {
    setError("");
    setLoading(true);
    try {
      const res = await api.post<{ access_token?: string; refresh_token?: string }>(
        "/api/public/invitation/accept",
        { token }
      );
      if (res.access_token && res.refresh_token) {
        localStorage.setItem("access_token", res.access_token);
        localStorage.setItem("refresh_token", res.refresh_token);
        await refreshUser();
        navigate("/welcome", { replace: true });
      } else {
        setError("Account created but could not sign you in. Please log in.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to accept invitation");
    } finally {
      setLoading(false);
    }
  };

  if (loadingInfo) {
    return (
      <div className="login-page">
        <div className="login-backdrop" />
        <div className="login-content">
          <div className="login-card" style={{ textAlign: "center", padding: "3rem" }}>
            <p style={{ color: "var(--text-muted)" }}>Loading invitation...</p>
          </div>
        </div>
      </div>
    );
  }

  if (infoError) {
    return (
      <div className="login-page">
        <div className="login-backdrop" />
        <div className="login-content">
          <div className="login-card">
            <div className="login-card-header">
              <div className="login-logo"><Logo /></div>
            </div>
            <div style={{ textAlign: "center", padding: "1rem 0" }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
              <p style={{ color: "var(--text-secondary)", margin: "1rem 0" }}>{infoError}</p>
              <Link to="/login" style={{ color: "var(--accent)", textDecoration: "none" }}>Go to Login</Link>
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
            <p className="login-subtitle">Accept Invitation</p>
          </div>

          <div style={{ background: "rgba(45,212,191,0.08)", border: "1px solid rgba(45,212,191,0.2)", borderRadius: 10, padding: "1rem", marginBottom: "1.5rem", textAlign: "center" }}>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", margin: 0 }}>
              {info?.invited_by && <><strong style={{ color: "var(--accent)" }}>{info.invited_by}</strong> invited you to join </>}
              <strong style={{ color: "var(--accent)" }}>{info?.company_name}</strong>
            </p>
            <p style={{ color: "var(--text-muted)", fontSize: "0.8rem", margin: "0.5rem 0 0" }}>
              {info?.email} &middot; Role: {info?.role || "user"}
            </p>
          </div>

          <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginBottom: "1.5rem", textAlign: "center" }}>
            Click Accept to create your account and go to the dashboard. You will set your password on the next page.
          </p>

          {error && <p className="error-msg login-error">{error}</p>}

          <button type="button" className="primary login-submit" onClick={handleAccept} disabled={loading}>
            <span className="login-submit-text">{loading ? "Creating account..." : "Accept & Continue"}</span>
          </button>

          <p style={{ textAlign: "center", marginTop: "1rem", fontSize: "0.875rem", color: "var(--text-muted)" }}>
            Already have an account?{" "}
            <Link to="/login" style={{ color: "var(--accent)", textDecoration: "none" }}>Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
