import { Link } from "react-router-dom";

export default function SecurityVpn() {
  return (
    <div className="container app-page">
      <div className="page-header">
        <h1>VPN</h1>
        <Link to="/security/whitelist-ip" className="btn-link">← Whitelist IP</Link>
      </div>
      <div className="card">
        <h2 className="card-subtitle">Coming soon</h2>
        <p style={{ color: "var(--text-muted)", marginBottom: 0 }}>
          VPN integration will be released in a future update.
        </p>
      </div>
    </div>
  );
}
