import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import LogoSpinner from "../components/LogoSpinner";

export default function AuthCallback() {
  const { refreshUser } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // HashRouter: tokens come from #/auth/callback?access_token=...&refresh_token=...
    const hash = window.location.hash.slice(1);
    const queryStart = hash.indexOf("?");
    const query = queryStart >= 0 ? hash.slice(queryStart + 1) : hash;
    const params = new URLSearchParams(query);
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");

    if (accessToken && refreshToken) {
      localStorage.setItem("access_token", accessToken);
      localStorage.setItem("refresh_token", refreshToken);
      window.history.replaceState(null, "", window.location.pathname + window.location.search + "#/");
      refreshUser(true)
        .then(() => {
          navigate("/", { replace: true });
        })
        .catch((err) => {
          setError(err instanceof Error ? err.message : "Failed to complete sign-in. Please try again.");
        });
    } else {
      setError("Missing tokens. Please try again.");
    }
  }, [refreshUser, navigate]);

  if (error) {
    return (
      <div className="login-page">
        <div className="login-backdrop" />
        <div className="login-content">
          <div className="login-card">
            <p className="error-msg">{error}</p>
            <Link to="/login" className="primary login-submit" style={{ display: "inline-block", textDecoration: "none", marginTop: "1rem" }}>
              Back to Login
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-loading" style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <LogoSpinner />
    </div>
  );
}
