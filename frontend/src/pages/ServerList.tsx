import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../components/Toast";
import DestructiveVerificationModal from "../components/DestructiveVerificationModal";
import Spinner from "../components/Spinner";

type ServerItem = {
  id: string;
  hostname: string;
  friendly_name: string | null;
  ip_address: string | null;
  description: string | null;
  status: string;
  created_at: string;
};

type ConnectionStatus = { status: "reachable" | "unreachable" | "unknown" | "checking"; checked_at?: string };

export default function ServerList() {
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const [servers, setServers] = useState<ServerItem[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<Record<string, ConnectionStatus>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<{ server: ServerItem; msg: string } | null>(null);

  const handleSyncNow = async (server: ServerItem) => {
    setSyncingId(server.id);
    const timeout = (ms: number) => new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Request timed out")), ms));
    try {
      const res = await Promise.race([
        api.post<{ ok?: boolean; success?: boolean; message?: string }>(`/api/servers/${server.id}/sync-now`),
        timeout(60000),
      ]);
      if (res?.success ?? res?.ok) {
        toast("success", "Sync completed successfully.");
      } else {
        toast("error", res?.message || "Sync failed");
      }
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncingId(null);
    }
  };

  const requestDeleteServer = async (server: ServerItem) => {
    let accessCount = 0;
    try {
      const access = await api.get<{ user_id: string }[]>(`/api/servers/${server.id}/access`);
      accessCount = Array.isArray(access) ? access.length : 0;
    } catch {
      // ignore
    }
    const name = server.friendly_name || server.hostname;
    const msg =
      accessCount > 0
        ? `"${name}" has ${accessCount} user(s) assigned. They will lose access. Remove this server anyway?`
        : `Remove server "${name}"? This cannot be undone.`;
    setConfirmTarget({ server, msg });
    setConfirmOpen(true);
  };

  const doDeleteServer = async (verificationToken: string) => {
    if (!confirmTarget) return;
    setConfirmOpen(false);
    const server = confirmTarget.server;
    setDeletingId(server.id);
    try {
      await api.delete(`/api/servers/${server.id}`, {
        headers: { "X-Destructive-Verification": verificationToken },
      });
      setServers((prev) => prev.filter((s) => s.id !== server.id));
      toast("success", `Server "${server.friendly_name || server.hostname}" deleted.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete server");
    } finally {
      setDeletingId(null);
    }
  };

  const fetchConnectionStatuses = () => {
    if (servers.length === 0) return;
    servers.forEach((s) => {
      setConnectionStatus((prev) => ({ ...prev, [s.id]: { ...prev[s.id], status: "checking" } }));
      api
        .get<{ status: string; checked_at: string }>(`/api/servers/${s.id}/status`)
        .then((data) => {
          setConnectionStatus((prev) => ({
            ...prev,
            [s.id]: { status: data.status as "reachable" | "unreachable" | "unknown", checked_at: data.checked_at },
          }));
        })
        .catch(() => {
          setConnectionStatus((prev) => ({ ...prev, [s.id]: { status: "unreachable" } }));
        });
    });
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .get<ServerItem[]>("/api/servers")
      .then((data) => {
        if (!cancelled) setServers(Array.isArray(data) ? data : []);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load servers");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (servers.length === 0) return;
    fetchConnectionStatuses();
    const interval = setInterval(fetchConnectionStatuses, 45000);
    return () => clearInterval(interval);
  }, [servers.map((s) => s.id).join(",")]);

  const filtered = servers.filter((s) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      s.hostname.toLowerCase().includes(q) ||
      (s.friendly_name || "").toLowerCase().includes(q) ||
      (s.ip_address || "").toLowerCase().includes(q) ||
      (s.description || "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="container app-page">
      <div className="page-header page-header-actions">
        <h1>Servers</h1>
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
          {!loading && servers.length > 0 && (
            <input
              type="text"
              placeholder="Search servers…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: 220, padding: "0.4rem 0.7rem", fontSize: "0.9rem" }}
            />
          )}
          {isAdmin && (
            <Link to="/server/add" style={{ display: "inline-block" }}>
              <button type="button" className="primary">Add server</button>
            </Link>
          )}
        </div>
      </div>

      {error && <p className="error-msg">{error}</p>}

      {loading ? (
        <Spinner />
      ) : filtered.length === 0 ? (
        <div className="card">
          <p className="text-muted" style={{ margin: 0 }}>
            {servers.length === 0
              ? <>No servers yet. {isAdmin && "Add a server by running the deploy command on a Linux host (see Add server)."}</>
              : "No servers match your search."}
          </p>
        </div>
      ) : (
        <>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{isAdmin ? "Hostname" : "Server"}</th>
                {isAdmin && (
                  <>
                    <th>IP</th>
                    <th>Description</th>
                  </>
                )}
                <th>Connection</th>
                {isAdmin && <th>Created</th>}
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => {
                const conn = connectionStatus[s.id];
                const connLabel =
                  conn?.status === "reachable" ? "Online"
                  : conn?.status === "unreachable" ? "Offline"
                  : conn?.status === "unknown" ? "Unknown"
                  : "Checking…";
                const connClass =
                  conn?.status === "reachable" ? "badge-success"
                  : conn?.status === "unreachable" ? "badge-danger"
                  : conn?.status === "unknown" ? "badge-warning"
                  : "";
                const connTitle =
                  conn?.status === "unknown" ? "Set IP address in server details to enable connection check." : undefined;
                const displayName = s.friendly_name || s.hostname;
                return (
                  <tr key={s.id}>
                    <td>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}>
                        {isAdmin && (
                          <button
                            type="button"
                            className="server-sync-icon-btn"
                            onClick={() => handleSyncNow(s)}
                            title={syncingId === s.id ? "Syncing…" : "Sync now (push users and keys to this server)"}
                            disabled={syncingId === s.id}
                            aria-label={syncingId === s.id ? "Syncing" : "Sync now"}
                          >
                            {syncingId === s.id ? (
                              <span className="server-sync-spinner" aria-hidden />
                            ) : (
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                <path d="M21 2v6h-6" />
                                <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                                <path d="M3 22v-6h6" />
                                <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
                              </svg>
                            )}
                          </button>
                        )}
                        <span>{displayName}</span>
                      </span>
                    </td>
                    {isAdmin && (
                      <>
                        <td className="text-muted">{s.ip_address || "—"}</td>
                        <td className="text-muted" style={{ maxWidth: 200 }}>{s.description || "—"}</td>
                      </>
                    )}
                    <td>
                      <span className={`badge ${connClass}`} title={connTitle}>{connLabel}</span>
                    </td>
                    {isAdmin && (
                      <td className="text-muted text-sm">
                        {s.created_at ? new Date(s.created_at).toLocaleDateString() : "—"}
                      </td>
                    )}
                    <td style={{ textAlign: "right" }}>
                      {isAdmin ? (
                        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", flexWrap: "wrap" }}>
                          <Link to={`/server/${s.id}`}>
                            <button type="button" className="btn-sm">Edit</button>
                          </Link>
                          <button
                            type="button"
                            className="btn-sm btn-outline-danger"
                            disabled={deletingId === s.id}
                            onClick={() => requestDeleteServer(s)}
                          >
                            {deletingId === s.id ? "Deleting…" : "Delete"}
                          </button>
                        </div>
                      ) : (
                        <Link to={`/server/${s.id}`}>
                          <button type="button" className="btn-sm">Open</button>
                        </Link>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      )}

      <DestructiveVerificationModal
        open={confirmOpen}
        title="Delete Server"
        message={confirmTarget?.msg || ""}
        action="delete_server"
        targetId={confirmTarget?.server.id ?? ""}
        targetName={confirmTarget?.server.friendly_name || confirmTarget?.server.hostname || ""}
        onVerified={doDeleteServer}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
