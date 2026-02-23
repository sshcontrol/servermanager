import { useState, useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import Logo from "../components/Logo";
import "./Login.css";

export default function VerifyEmail() {
  const [params] = useSearchParams();
  const verified = params.get("verified");
  const urlMessage = params.get("message");
  const token = params.get("token");

  const [status, setStatus] = useState<"verifying" | "success" | "error">(
    verified === "1" ? "success" : verified === "0" ? "error" : "verifying"
  );
  const [message, setMessage] = useState(
    urlMessage || ""
  );

  useEffect(() => {
    // If we arrived via the backend GET redirect, result is already in URL params
    if (verified !== null) return;

    // Fallback: if someone hits this page with a raw token, call the POST endpoint
    if (!token) {
      setStatus("error");
      setMessage("No verification token found in the URL.");
      return;
    }

    api.post<{ message: string }>("/api/public/verify-email", { token })
      .then((res) => {
        setStatus("success");
        setMessage(res.message);
      })
      .catch((err) => {
        setStatus("error");
        setMessage(err instanceof Error ? err.message : "Verification failed");
      });
  }, [token, verified]);

  return (
    <div className="login-page">
      <div className="login-backdrop" />
      <div className="login-content">
        <div className="login-card">
          <div className="login-card-header">
            <div className="login-logo"><Logo /></div>
            <p className="login-subtitle">Email Verification</p>
          </div>
          <div style={{ textAlign: "center", padding: "1.5rem 0" }}>
            {status === "verifying" && (
              <p style={{ color: "var(--text-secondary)" }}>Verifying your email...</p>
            )}
            {status === "success" && (
              <>
                <div style={{ marginBottom: "1rem" }}>
                  <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#2dd4bf" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                </div>
                <p style={{ color: "var(--text-secondary)", marginBottom: "1.5rem", lineHeight: 1.6 }}>{message}</p>
                <Link to="/login" className="primary login-submit" style={{ textDecoration: "none", display: "inline-block" }}>
                  Go to Login
                </Link>
              </>
            )}
            {status === "error" && (
              <>
                <div style={{ marginBottom: "1rem" }}>
                  <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
                </div>
                <p style={{ color: "#ef4444", marginBottom: "1.5rem", lineHeight: 1.6 }}>{message}</p>
                <Link to="/login" className="primary login-submit" style={{ textDecoration: "none", display: "inline-block" }}>
                  Go to Login
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
