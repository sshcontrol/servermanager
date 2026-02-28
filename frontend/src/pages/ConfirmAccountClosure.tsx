import { useSearchParams, Link } from "react-router-dom";
import Logo from "../components/Logo";
import "./Login.css";

export default function ConfirmAccountClosure() {
  const [params] = useSearchParams();
  const closed = params.get("closed");
  const message = params.get("message");
  const error = params.get("error");

  return (
    <div className="login-page">
      <div className="login-backdrop" />
      <div className="login-content">
        <div className="login-card">
          <div className="login-card-header">
            <div className="login-logo"><Logo /></div>
            <p className="login-subtitle">
              {closed ? "Account closed" : error ? "Error" : "Confirm account closure"}
            </p>
          </div>
          <div style={{ textAlign: "center", padding: "1rem 0" }}>
            {closed ? (
              <>
                <div style={{ marginBottom: "1rem" }}>
                  <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#2dd4bf" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                    <polyline points="22 4 12 14.01 9 11.01" />
                  </svg>
                </div>
                <p style={{ color: "var(--text-secondary)", marginBottom: "1.5rem", lineHeight: 1.6 }}>
                  {message || "Your account has been closed."}
                </p>
                <Link to="/login" className="primary login-submit" style={{ textDecoration: "none", display: "inline-block" }}>
                  Go to Login
                </Link>
              </>
            ) : error ? (
              <>
                <p style={{ color: "#ef4444", marginBottom: "1.5rem" }}>{error}</p>
                <Link to="/login" className="primary login-submit" style={{ textDecoration: "none", display: "inline-block" }}>
                  Go to Login
                </Link>
              </>
            ) : (
              <p style={{ color: "var(--text-muted)" }}>
                No token provided. If you received an email, use the link from that email.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
