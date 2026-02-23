import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import ErrorBoundary from "../components/ErrorBoundary";

const OS_LIST: { id: string; label: string; icon: string }[] = [
  { id: "ubuntu_21_25", label: "Ubuntu 21–25", icon: "🟠" },
  { id: "ubuntu_18_20", label: "Ubuntu 18–20", icon: "🟠" },
  { id: "rocky_8_10", label: "Rocky Linux 8–10", icon: "🪨" },
  { id: "rhel_8_10", label: "Red Hat Enterprise 8–10", icon: "🔴" },
  { id: "rhel_7", label: "Red Hat Enterprise 7", icon: "🔴" },
  { id: "oracle_8_10", label: "Oracle Linux 8–10", icon: "🔶" },
  { id: "oracle_7", label: "Oracle Linux 7", icon: "🔶" },
  { id: "debian_10_13", label: "Debian 10–13", icon: "🔴" },
  { id: "centos_8_10", label: "CentOS 8–10", icon: "🟢" },
  { id: "centos_7", label: "CentOS 7", icon: "🟢" },
  { id: "amazon_2023", label: "Amazon Linux 2023", icon: "📦" },
  { id: "amazon_2", label: "Amazon Linux 2", icon: "📦" },
  { id: "alma_8_10", label: "AlmaLinux 8–10", icon: "🔵" },
];

type PlanLimits = { max_servers: number; current_servers: number };

export default function ServerAdd() {
  const [deployInfo, setDeployInfo] = useState<{ token: string; api_url: string } | null>(null);
  const [limits, setLimits] = useState<PlanLimits | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      api.get<{ token: string; api_url: string }>("/api/servers/deploy/token"),
      api.get<PlanLimits>("/api/auth/plan-limits").catch(() => null),
    ])
      .then(([deployData, limitsData]) => {
        if (cancelled) return;
        const token = deployData?.token != null ? String(deployData.token) : "";
        const api_url = deployData?.api_url != null ? String(deployData.api_url) : "";
        setDeployInfo({ token, api_url });
        setLimits(limitsData || null);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load deployment token");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const atServerLimit = limits && limits.current_servers >= limits.max_servers;

  // Defensive: ensure api_url is a string so we never throw when rendering (e.g. in <code>{apiBase}</code>)
  const apiBase =
    typeof deployInfo?.api_url === "string"
      ? deployInfo.api_url.replace(/\/$/, "")
      : "";
  const token =
    typeof deployInfo?.token === "string" ? deployInfo.token : null;

  const getDeployCommand = (osId: string) => {
    if (!token || !apiBase) return "";
    const url = `${apiBase}/api/servers/deploy/script?token=${encodeURIComponent(token)}&os_id=${encodeURIComponent(osId)}`;
    return `curl -sSL "${url}" | sudo bash`;
  };

  const copyToClipboard = (text: string, osId: string) => {
    const done = () => {
      setCopiedId(osId);
      setTimeout(() => setCopiedId(null), 2500);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, osId));
    } else {
      fallbackCopy(text, osId);
    }
  };

  const fallbackCopy = (text: string, osId?: string) => {
    if (!text) return;
    const el = document.createElement("textarea");
    el.value = text;
    el.setAttribute("readonly", "");
    el.style.position = "absolute";
    el.style.left = "-9999px";
    document.body.appendChild(el);
    el.select();
    try {
      document.execCommand("copy");
      if (osId) {
        setCopiedId(osId);
        setTimeout(() => setCopiedId(null), 2500);
      }
    } finally {
      document.body.removeChild(el);
    }
  };

  const handleCardClick = (osId: string) => {
    const cmd = getDeployCommand(osId);
    if (!cmd) return;
    copyToClipboard(cmd, osId);
  };

  return (
    <ErrorBoundary>
    <div className="container app-page">
      <div className="page-header">
        <h1>Add server</h1>
        <Link to="/server" className="btn-link">← Back to servers</Link>
      </div>

      {limits && (
        <div style={{ marginBottom: "1rem", padding: "0.75rem 1rem", background: atServerLimit ? "rgba(239,68,68,0.1)" : "rgba(45,212,191,0.08)", border: `1px solid ${atServerLimit ? "rgba(239,68,68,0.3)" : "rgba(45,212,191,0.2)"}`, borderRadius: 10, fontSize: "0.9rem" }}>
          {limits.current_servers} of {limits.max_servers} servers
          {atServerLimit && (
            <span style={{ color: "var(--danger)", marginLeft: "0.5rem" }}>— Limit reached. Upgrade your plan in <Link to="/profile/plan" style={{ color: "var(--accent)" }}>Profile → Plan</Link> to add more servers.</span>
          )}
        </div>
      )}

      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <h2 className="card-subtitle">Deploy to a Linux server</h2>
        <p style={{ color: "var(--text-muted)", marginBottom: "1rem", fontSize: "0.95rem" }}>
          Choose your distribution. Click a card to copy the deploy command, then run it on the server (as root or with sudo). The script will install curl and SSH if needed, open port 22, then register the server and install keys.
        </p>
        {loading ? (
          <p style={{ color: "var(--text-muted)" }}>Loading deployment token…</p>
        ) : error ? (
          <p className="error-msg">{error}</p>
        ) : !token ? (
          <p className="error-msg">Deployment token not available.</p>
        ) : atServerLimit ? (
          <p style={{ color: "var(--danger)", padding: "1rem", background: "rgba(239,68,68,0.1)", borderRadius: 8 }}>
            Server limit reached. Upgrade your plan in <Link to="/profile/plan" style={{ color: "var(--accent)" }}>Profile → Plan</Link> to add more servers. The deploy command will fail until you upgrade.
          </p>
        ) : (
          <>
            <div className="server-add-cards">
              {OS_LIST.map((os) => {
                const isCopied = copiedId === os.id;
                return (
                  <div
                    key={os.id}
                    className="server-add-card"
                    role="button"
                    tabIndex={0}
                    onClick={() => handleCardClick(os.id)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleCardClick(os.id); } }}
                  >
                    <div className="server-add-card-icon">{os.icon}</div>
                    <div className="server-add-card-label">{os.label}</div>
                    <div className="server-add-card-hint">
                      {isCopied ? "✓ Copied — ready to paste" : "Click to copy command"}
                    </div>
                  </div>
                );
              })}
            </div>
            <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "1rem" }}>
              After the script runs successfully, the server will appear in <Link to="/server">Servers</Link>. You can then grant user access per server.
            </p>
          </>
        )}
      </div>

      <div className="card">
        <h2 className="card-subtitle">Requirements</h2>
        <ul style={{ color: "var(--text-muted)", fontSize: "0.95rem", margin: 0, paddingLeft: "1.25rem" }}>
          <li>Script installs <code>curl</code> and <code>openssh-server</code> if missing, and allows port 22 in the firewall when possible.</li>
          <li>Generate the platform SSH key first in <Link to="/profile/keys">Profile → Key</Link> if you have not already.</li>
        </ul>
      </div>

      <div className="card" style={{ marginTop: "1.5rem" }}>
        <h2 className="card-subtitle">If the deploy command shows an error</h2>
        <p style={{ color: "var(--text-muted)", fontSize: "0.95rem", marginBottom: "0.5rem" }}>
          If you see <strong>syntax errors</strong>, <strong>command not found</strong>, or <strong>{"Invalid deployment token"}</strong> when running the curl command on the Ubuntu server, the API usually returned an error (e.g. 401) and that response was piped into bash.
        </p>
        <ul style={{ color: "var(--text-muted)", fontSize: "0.95rem", margin: 0, paddingLeft: "1.25rem" }}>
          <li><strong>Invalid or expired token</strong> — Copy a <strong>new</strong> deploy command from this page (click the card again). If the database was reset or the token was recreated, old URLs no longer work.</li>
          <li><strong>Connection refused / timeout</strong> — The Ubuntu server must reach the API URL (e.g. <code>{apiBase || "http://YOUR_MANAGER_IP:8000"}</code>). From the Ubuntu server run: <code>curl -s -o /dev/null -w {"%{http_code}"} {apiBase || "http://YOUR_IP:8000"}/health</code> — it should return <code>200</code>. Open port 8000 on the manager firewall if needed.</li>
          <li><strong>Failed to register server</strong> — The script will print the API response. Check that the token is valid and the server can reach the API.</li>
        </ul>
      </div>
    </div>
    </ErrorBoundary>
  );
}
