import { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
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
  const { user, isAdmin } = useAuth();
  const location = useLocation();
  const [deployInfo, setDeployInfo] = useState<{ token: string; api_url: string } | null>(null);
  const [limits, setLimits] = useState<PlanLimits | null>(null);
  const [hasSshKey, setHasSshKey] = useState<boolean | null>(null);
  const [hasPlatformKey, setHasPlatformKey] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const has2FA = user?.totp_enabled === true;
  const hasSMS = user?.phone_verified === true;
  const needsSecurity = !has2FA && !hasSMS;
  // Admin needs either personal key OR platform key (platform key is generated on Key page)
  const sshKeyCheckPending = isAdmin && (hasSshKey === null || hasPlatformKey === null);
  const needsSshKey = isAdmin && !sshKeyCheckPending && hasSshKey === false && hasPlatformKey === false;

  useEffect(() => {
    if (isAdmin && location.pathname === "/server/add") {
      api.get<{ has_key: boolean }>("/api/users/me/ssh-key").then((d) => setHasSshKey(d.has_key)).catch(() => setHasSshKey(null));
      api.get<{ has_key: boolean }>("/api/admin/ssh-key").then((d) => setHasPlatformKey(d.has_key)).catch(() => setHasPlatformKey(null));
    } else if (!isAdmin) {
      setHasSshKey(true);
      setHasPlatformKey(null);
    }
  }, [isAdmin, location.pathname, location.key]);

  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === "visible" && isAdmin && location.pathname === "/server/add") {
        api.get<{ has_key: boolean }>("/api/users/me/ssh-key").then((d) => setHasSshKey(d.has_key)).catch(() => setHasSshKey(null));
        api.get<{ has_key: boolean }>("/api/admin/ssh-key").then((d) => setHasPlatformKey(d.has_key)).catch(() => setHasPlatformKey(null));
      }
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [isAdmin, location.pathname]);

  useEffect(() => {
    if (needsSecurity || needsSshKey || sshKeyCheckPending) {
      if (!sshKeyCheckPending) setLoading(false);
      return;
    }
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
  }, [needsSecurity, needsSshKey, sshKeyCheckPending]);

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
            <span style={{ color: "var(--danger)", marginLeft: "0.5rem" }}>— Limit reached. Upgrade your plan in <Link to="/plan-billing/plan" style={{ color: "var(--accent)" }}>Plan & Billing</Link> to add more servers.</span>
          )}
        </div>
      )}

      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <h2 className="card-subtitle">Deploy to a Linux server</h2>
        <p style={{ color: "var(--text-muted)", marginBottom: "1rem", fontSize: "0.95rem" }}>
          Choose your distribution. Click a card to copy the deploy command, then run it on the server (as root or with sudo). The script will install curl and SSH if needed, open port 22, then register the server and install keys.
        </p>
        {needsSecurity ? (
          <div style={{ padding: "1.5rem", background: "rgba(255,193,7,0.12)", border: "1px solid rgba(255,193,7,0.4)", borderRadius: 10 }}>
            <p style={{ margin: "0 0 0.75rem", fontWeight: 600, color: "var(--text-primary)" }}>Enable second-layer security first</p>
            <p style={{ margin: "0 0 1rem", color: "var(--text-secondary)", fontSize: "0.95rem", lineHeight: 1.5 }}>
              To add a server, you must enable either 2FA (authenticator app) or SMS verification. This protects your account and infrastructure.
            </p>
            <Link to="/profile/security" className="primary" style={{ display: "inline-block", padding: "0.5rem 1rem", textDecoration: "none", borderRadius: 8 }}>
              Go to Profile → Security
            </Link>
          </div>
        ) : needsSshKey ? (
          <div style={{ padding: "1.5rem", background: "rgba(255,193,7,0.12)", border: "1px solid rgba(255,193,7,0.4)", borderRadius: 10 }}>
            <p style={{ margin: "0 0 0.75rem", fontWeight: 600, color: "var(--text-primary)" }}>Add your SSH key first</p>
            <p style={{ margin: "0 0 1rem", color: "var(--text-secondary)", fontSize: "0.95rem", lineHeight: 1.5 }}>
              To deploy and connect to servers, you need an SSH key. Upload your public key or generate one on the Key page.
            </p>
            <Link to="/keys" className="primary" style={{ display: "inline-block", padding: "0.5rem 1rem", textDecoration: "none", borderRadius: 8 }}>
              Go to Key page
            </Link>
          </div>
        ) : (loading || sshKeyCheckPending) ? (
          <p style={{ color: "var(--text-muted)" }}>{sshKeyCheckPending ? "Checking SSH key…" : "Loading deployment token…"}</p>
        ) : error ? (
          <p className="error-msg">{error}</p>
        ) : !token ? (
          <p className="error-msg">Deployment token not available.</p>
        ) : atServerLimit ? (
          <p style={{ color: "var(--danger)", padding: "1rem", background: "rgba(239,68,68,0.1)", borderRadius: 8 }}>
            Server limit reached. Upgrade your plan in <Link to="/plan-billing/plan" style={{ color: "var(--accent)" }}>Plan & Billing</Link> to add more servers. The deploy command will fail until you upgrade.
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
    </div>
    </ErrorBoundary>
  );
}
