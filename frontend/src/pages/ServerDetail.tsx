import { useState, useEffect } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { api, downloadFile } from "../api/client";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../components/Toast";
import ConfirmModal from "../components/ConfirmModal";
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
  sync_requested_at?: string | null;
  server_groups?: { id: string; name: string }[];
};

type AccessItem = { user_id: string; username: string; role: string };

type UserGroupAccessItem = { user_group_id: string; name: string; role: string };

type UserItem = { id: string; username: string; email: string; is_superuser?: boolean; roles?: { id: string; name: string }[] };

export default function ServerDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user: currentUser, isAdmin } = useAuth();
  const linuxUsername = (currentUser?.username || "root").toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/^_+|_+$/g, "") || "user";
  const [server, setServer] = useState<ServerItem | null>(null);
  const [access, setAccess] = useState<AccessItem[]>([]);
  const [userGroups, setUserGroups] = useState<UserGroupAccessItem[]>([]);
  const [allUserGroups, setAllUserGroups] = useState<{ id: string; name: string }[]>([]);
  const [addUserGroupId, setAddUserGroupId] = useState("");
  const [addUserGroupRole, setAddUserGroupRole] = useState<"root" | "user">("user");
  const [users, setUsers] = useState<UserItem[]>([]);
  const [friendlyName, setFriendlyName] = useState("");
  const [description, setDescription] = useState("");
  const [ipAddress, setIpAddress] = useState("");
  const [addUserId, setAddUserId] = useState("");
  const [addRole, setAddRole] = useState<"root" | "user">("user");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accessGrantedMessage, setAccessGrantedMessage] = useState<string | null>(null);
  const [connectStatus, setConnectStatus] = useState<"reachable" | "unreachable" | "unknown" | "checking" | null>(null);
  const [copiedId, setCopiedId] = useState<"cmd" | "host" | "win" | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const { toast, showSuccessModal } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{ msg: string; title: string; fn: () => Promise<void> } | null>(null);
  const [deleteServerModalOpen, setDeleteServerModalOpen] = useState(false);

  const loadAccess = () => {
    if (!id) return;
    api.get<AccessItem[]>(`/api/servers/${id}/access`).then(setAccess).catch(() => setAccess([]));
  };

  const loadServer = () => {
    if (!id) return;
    api.get<ServerItem>(`/api/servers/${id}`).then((s) => setServer(s)).catch(() => {});
  };

  useEffect(() => {
    if (!id || !server?.sync_requested_at) return;
    const iv = setInterval(loadServer, 30000);
    return () => clearInterval(iv);
  }, [id, server?.sync_requested_at]);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setError(null);
    if (isAdmin) {
      // Load server data first (essential), then load supplementary data independently.
      // If supplementary calls fail, the page still renders with server details and edit/delete.
      api
        .get<ServerItem>(`/api/servers/${id}`)
        .then((s) => {
          setServer(s);
          setFriendlyName(s.friendly_name || "");
          setDescription(s.description || "");
          setIpAddress(s.ip_address || "");
          setLoading(false);
          // Load supplementary data in parallel; failures don't block the page
          api.get<AccessItem[]>(`/api/servers/${id}/access`).then(setAccess).catch(() => setAccess([]));
          api.get<UserGroupAccessItem[]>(`/api/servers/${id}/user-groups`).then((ugList) => setUserGroups(Array.isArray(ugList) ? ugList : [])).catch(() => setUserGroups([]));
          api.get<{ users: UserItem[]; total: number }>("/api/users?limit=500").then((r) => setUsers((r.users || []).filter((u) => !(u.is_superuser || (u.roles || []).some((role) => role.name === "admin"))))).catch(() => setUsers([]));
          api.get<{ id: string; name: string }[]>("/api/user-groups").then((r) => setAllUserGroups(Array.isArray(r) ? r : [])).catch(() => setAllUserGroups([]));
        })
        .catch((e) => {
          setError(e instanceof Error ? e.message : "Failed to load");
          setServer(null);
          setLoading(false);
        });
    } else {
      api
        .get<ServerItem>(`/api/servers/${id}`)
        .then((s) => {
          setServer(s);
          setFriendlyName(s.friendly_name || "");
          setDescription(s.description || "");
          setIpAddress(s.ip_address || "");
        })
        .catch((e) => {
          setError(e instanceof Error ? e.message : "Failed to load");
          setServer(null);
        })
        .finally(() => setLoading(false));
    }
  }, [id, isAdmin]);

  useEffect(() => {
    if (server) {
      setFriendlyName(server.friendly_name || "");
      setDescription(server.description || "");
      setIpAddress(server.ip_address || "");
    }
  }, [server]);

  useEffect(() => {
    if (!isAdmin && server?.id) {
      setConnectStatus("checking");
      api
        .get<{ status: string }>(`/api/servers/${server.id}/status`)
        .then((d) =>
          setConnectStatus(
            d.status === "reachable" ? "reachable" : d.status === "unknown" ? "unknown" : "unreachable"
          )
        )
        .catch(() => setConnectStatus("unreachable"));
    }
  }, [isAdmin, server?.id]);

  const saveServer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await api.patch<ServerItem>(`/api/servers/${id}`, {
        friendly_name: friendlyName.trim() || null,
        description: description || null,
        ip_address: ipAddress.trim() || null,
      });
      setServer(updated);
      showSuccessModal();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteServer = () => {
    if (!id || !server) return;
    setDeleteServerModalOpen(true);
  };

  const doDeleteServer = async (verificationToken: string) => {
    if (!id || !server) return;
    setDeleteServerModalOpen(false);
    const name = server.friendly_name || server.hostname;
    setDeleting(true);
    setError(null);
    try {
      await api.delete(`/api/servers/${id}`, {
        headers: { "X-Destructive-Verification": verificationToken },
      });
      toast("success", `Server "${name}" deleted.`);
      navigate("/server");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete server");
    } finally {
      setDeleting(false);
    }
  };

  const formatSyncResults = (results: { server_name: string; success: boolean; error?: string }[]) => {
    const ok = results.filter((r) => r.success);
    const fail = results.filter((r) => !r.success);
    if (fail.length === 0) return `Sync completed on ${ok.length} server(s).`;
    if (ok.length === 0) return `Sync failed: ${fail.map((r) => r.error || "Unknown").join("; ")}`;
    return `${ok.length} synced, ${fail.length} failed: ${fail.map((r) => r.error).join("; ")}`;
  };

  const addAccess = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || !addUserId) return;
    const selectedUser = users.find((u) => u.id === addUserId);
    const userName = selectedUser ? selectedUser.username : "User";
    setSaving(true);
    setError(null);
    setAccessGrantedMessage(null);
    try {
      const res = await api.post<{ ok?: boolean; sync_results?: { server_name: string; success: boolean; error?: string }[] }>(
        `/api/servers/${id}/access`,
        { user_id: addUserId, role: addRole }
      );
      loadAccess();
      loadServer();
      setAddUserId("");
      const sync = res?.sync_results || [];
      const syncMsg = sync.length > 0 ? formatSyncResults(sync) : "Sync completed.";
      setAccessGrantedMessage(
        `${userName} is now granted access. ${syncMsg} They can log in, go to Servers, open this server, and use "Download my SSH key" plus the SSH command to connect. For PuTTY on Windows they should download the PPK key and load it under Connection → SSH → Auth → Private key.`
      );
      showSuccessModal("Access granted successfully.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add access");
    } finally {
      setSaving(false);
    }
  };

  const removeAccess = (userId: string) => {
    if (!id) return;
    setConfirmAction({
      title: "Revoke Access",
      msg: "Revoke this user's access to the server?",
      fn: async () => {
        setSaving(true);
        setError(null);
        try {
          const res = await api.delete<{ ok?: boolean; sync_results?: { server_name: string; success: boolean; error?: string }[] }>(
            `/api/servers/${id}/access/${userId}`
          );
          const sync = res?.sync_results || [];
          const msg = sync.length > 0 ? formatSyncResults(sync) : "Access revoked.";
          showSuccessModal(msg);
          loadAccess();
          loadServer();
        } catch (e) {
          toast("error", e instanceof Error ? e.message : "Failed to revoke");
        } finally {
          setSaving(false);
        }
      },
    });
    setConfirmOpen(true);
  };

  const handleSyncNow = async () => {
    if (!id) return;
    setSyncing(true);
    setSyncMessage(null);
    const timeout = (ms: number) => new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Request timed out")), ms));
    try {
      const res = await Promise.race([
        api.post<{ ok?: boolean; success?: boolean; message?: string }>(`/api/servers/${id}/sync-now`),
        timeout(60000),
      ]);
      if (res?.success ?? res?.ok) {
        setSyncMessage({ text: "Sync completed successfully.", type: "success" });
        loadServer();
      } else {
        setSyncMessage({ text: res?.message || "Sync failed", type: "error" });
      }
      setTimeout(() => setSyncMessage(null), 5000);
    } catch (e) {
      setSyncMessage({ text: e instanceof Error ? e.message : "Sync failed", type: "error" });
      setTimeout(() => setSyncMessage(null), 5000);
    } finally {
      setSyncing(false);
    }
  };

  if (!id) {
    navigate("/server");
    return null;
  }
  if (loading && !server) {
    return (
      <div className="container app-page">
        <Spinner />
      </div>
    );
  }
  if (!server) {
    return (
      <div className="container app-page">
        <p className="error-msg">{error || "Server not found"}</p>
        <Link to="/server">← Back to servers</Link>
      </div>
    );
  }

  const accessUserIds = new Set(Array.isArray(access) ? access.map((a) => a.user_id) : []);
  const sshHost = server.ip_address || server.hostname;
  const copyToClipboard = (text: string, id: "cmd" | "host" | "win") => {
    const done = () => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
    } else {
      fallbackCopy(text, done);
    }
  };
  const fallbackCopy = (text: string, done: () => void) => {
    const el = document.createElement("textarea");
    el.value = text;
    el.setAttribute("readonly", "");
    el.style.position = "absolute";
    el.style.left = "-9999px";
    document.body.appendChild(el);
    el.select();
    try {
      document.execCommand("copy");
      done();
    } finally {
      document.body.removeChild(el);
    }
  };
  const copyHost = () => copyToClipboard(sshHost, "host");

  const handleDownloadKey = () => {
    downloadFile("/api/users/me/ssh-key/download?format=pem", "sshcontrol-key.pem").catch(() => {});
  };

  return (
    <div className="container app-page">
      <div className="page-header" style={{ marginBottom: "1rem" }}>
        <Link to="/server" className="btn-link">← Servers</Link>
        <h1 style={{ marginTop: "0.5rem", display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          {server.friendly_name || server.hostname}
          {isAdmin && (
            <button
              type="button"
              className="server-sync-icon-btn"
              onClick={handleSyncNow}
              title={syncing ? "Syncing…" : "Sync now (push users and keys to this server)"}
              disabled={syncing}
              aria-label={syncing ? "Syncing" : "Sync now"}
            >
              {syncing ? (
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
        </h1>
        {isAdmin && (
          <p style={{ color: "var(--text-muted)", fontSize: "0.95rem", margin: 0 }}>
            {server.hostname !== (server.friendly_name || server.hostname) && <span>{server.hostname}</span>}
            {server.ip_address && (server.hostname !== (server.friendly_name || server.hostname) ? " · " : "")}
            {server.ip_address && <span>{server.ip_address}</span>}
            <span> · Status: {server.status}</span>
          </p>
        )}
      </div>

      {error && <p className="error-msg">{error}</p>}
      {server?.sync_requested_at && (
        <div
          className="badge badge-warning"
          style={{
            marginBottom: "1rem",
            padding: "0.75rem 1rem",
            fontSize: "0.95rem",
            display: "inline-flex",
            alignItems: "center",
            gap: "0.5rem",
          }}
        >
          <span className="server-sync-spinner" aria-hidden style={{ width: 16, height: 16 }} />
          This server is synchronizing. Changes will apply within 5 minutes.
        </div>
      )}
      {syncMessage && (
        <p className={syncMessage.type === "error" ? "error-msg" : "success-msg"} style={{ marginBottom: "1rem" }}>
          {syncMessage.text}
        </p>
      )}

      {!isAdmin && (
        <div className="card" style={{ marginBottom: "1.5rem" }}>
          <h2 className="card-subtitle">Connect to this server</h2>
          <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginBottom: "0.5rem" }}>
            You have <strong>one key</strong> for all your assigned servers. Use the same PPK (or PEM) for every server—only the host changes. In PuTTY, keep the same private key and change the host for each server.
          </p>
          <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginBottom: "1rem" }}>
            Connection is shown as{" "}
            {connectStatus === "reachable" ? (
              <span className="badge badge-success">Online</span>
            ) : connectStatus === "unreachable" ? (
              <span className="badge badge-danger">Offline</span>
            ) : connectStatus === "unknown" ? (
              <span className="badge badge-warning" title="Set IP address below to enable connection check.">Unknown</span>
            ) : (
              <span className="badge">Checking…</span>
            )}
          </p>
          <div className="form-group">
            <label>For PuTTY (Windows) — no password, key only</label>
            <p style={{ fontSize: "0.9rem", color: "var(--text-muted)", marginBottom: "0.5rem" }}>
              Session → Host Name: <strong>{sshHost}</strong> · Port: <strong>22</strong> · <strong>Auto-login username: {linuxUsername}</strong>. Then Connection → SSH → Auth → Private key file: browse to your <strong>.ppk</strong> file. If PuTTY still asks for a password, check that the username is <strong>{linuxUsername}</strong> and the PPK is set under Auth.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
              <code style={{ padding: "0.35rem 0.5rem", background: "var(--bg-elevated)", borderRadius: 4, fontSize: "0.9rem" }}>{sshHost}</code>
              <button type="button" className="btn-sm" onClick={copyHost}>
                {copiedId === "host" ? "Copied!" : "Copy host"}
              </button>
            </div>
          </div>
          <div className="form-group">
            <button type="button" className="primary" onClick={handleDownloadKey}>
              Download my SSH key (PEM)
            </button>
            <span style={{ marginLeft: "0.5rem" }}>
              <button
                type="button"
                className="btn-sm"
                onClick={() => downloadFile("/api/users/me/ssh-key/download?format=ppk", "sshcontrol-key.ppk")}
              >
                Download PPK (for PuTTY)
              </button>
            </span>
            <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "0.5rem", marginBottom: 0 }}>
              Keep your key secure. You log in with your key only — no password. The server creates a Linux user matching your panel username (e.g. <strong>{linuxUsername}</strong>) when you are added; sync runs every 5 min. If you were just added, wait a few minutes or ask your admin to re-run the deploy script on the server.
            </p>
          </div>
          <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "1rem", marginBottom: 0, paddingTop: "0.75rem", borderTop: "1px solid var(--border)" }}>
            <strong>If a server is removed or your access is revoked:</strong> that key will no longer work on that server only. Your same key still works on all other assigned servers.
          </p>
        </div>
      )}

      {isAdmin && (
      <>
      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <h2 className="card-subtitle">Server details</h2>
        {(server.server_groups?.length ?? 0) > 0 && (
          <div className="form-group" style={{ marginBottom: "1rem" }}>
            <label>Member of groups</label>
            <p style={{ margin: "0.35rem 0 0", display: "flex", flexWrap: "wrap", gap: "0.25rem" }}>
              {server.server_groups!.map((g) => (
                <Link key={g.id} to={`/server-groups/${g.id}`} className="badge badge-info" style={{ textDecoration: "none" }}>
                  {g.name}
                </Link>
              ))}
            </p>
          </div>
        )}
        <form onSubmit={saveServer}>
          <div className="form-group">
            <label htmlFor="server-friendly-name">Friendly name</label>
            <input
              id="server-friendly-name"
              type="text"
              value={friendlyName}
              onChange={(e) => setFriendlyName(e.target.value)}
              placeholder="e.g. Production Web"
              maxLength={255}
              style={{ maxWidth: "400px" }}
            />
          </div>
          <div className="form-group">
            <label htmlFor="server-ip">IP / host for connection check</label>
            <input
              id="server-ip"
              type="text"
              value={ipAddress}
              onChange={(e) => setIpAddress(e.target.value)}
              placeholder="e.g. host.docker.internal or 172.17.0.1"
              style={{ maxWidth: "400px" }}
            />
          </div>
          <div className="form-group">
            <label htmlFor="server-desc">Description</label>
            <textarea
              id="server-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              style={{ maxWidth: "400px" }}
            />
          </div>
          <button type="submit" className="primary" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
          {isAdmin && (
            <button
              type="button"
              className="btn-sm btn-outline-danger"
              style={{ marginLeft: "0.75rem" }}
              disabled={deleting || saving}
              onClick={handleDeleteServer}
            >
              {deleting ? "Deleting…" : "Delete server"}
            </button>
          )}
        </form>
      </div>

      <div className="card">
        <h2 className="card-subtitle">User access</h2>
        {accessGrantedMessage && (
          <p className="success-msg" style={{ marginBottom: "1rem" }}>
            {accessGrantedMessage}
          </p>
        )}
        <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginBottom: "1rem" }}>
          Users with access can see this server. Role: <strong>root</strong> (Linux elevated/sudo), <strong>user</strong> (Linux regular).
        </p>

        <div className="table-wrap" style={{ marginBottom: "1.5rem" }}>
          <table className="table" style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                <th style={{ textAlign: "left", padding: "0.75rem" }}>User</th>
                <th style={{ textAlign: "left", padding: "0.75rem" }}>Role</th>
                <th style={{ textAlign: "right", padding: "0.75rem" }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {access.length === 0 ? (
                <tr>
                  <td colSpan={3} style={{ padding: "0.75rem", color: "var(--text-muted)", textAlign: "center" }}>
                    No users assigned yet. Add a user below.
                  </td>
                </tr>
              ) : access.map((a) => (
                <tr key={a.user_id} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "0.75rem" }}>{a.username}</td>
                  <td style={{ padding: "0.75rem" }}><span className="badge">{a.role === "root" || a.role === "admin" ? "Root" : "User"}</span></td>
                  <td style={{ padding: "0.75rem", textAlign: "right" }}>
                    <button type="button" className="btn-link danger" onClick={() => removeAccess(a.user_id)} disabled={saving}>
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <form onSubmit={addAccess} style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "flex-end" }}>
          <div className="form-group" style={{ marginBottom: 0, minWidth: "200px" }}>
            <label htmlFor="add-user">Add user</label>
            <select
              id="add-user"
              value={addUserId}
              onChange={(e) => setAddUserId(e.target.value)}
            >
              <option value="">Select user…</option>
              {users
                .filter((u) => !accessUserIds.has(u.id))
                .map((u) => (
                  <option key={u.id} value={u.id}>{u.username} ({u.email})</option>
                ))}
            </select>
          </div>
          <div className="form-group" style={{ marginBottom: 0, minWidth: "120px" }}>
            <label htmlFor="add-role">Role</label>
            <select
              id="add-role"
              value={addRole}
              onChange={(e) => setAddRole(e.target.value as "root" | "user")}
            >
              <option value="user">user</option>
              <option value="root">root</option>
            </select>
          </div>
          <button type="submit" className="primary" disabled={saving || !addUserId}>
            {saving ? "Adding…" : "Grant access"}
          </button>
        </form>
      </div>

      <div className="card" style={{ marginTop: "1.5rem" }}>
        <h2 className="card-subtitle">User groups</h2>
        <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginBottom: "1rem" }}>
          All members of a user group get the same role on this server. Manage groups under <Link to="/user-groups">User groups</Link>.
        </p>
        <div className="table-wrap" style={{ marginBottom: "1rem" }}>
          <table className="table" style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                <th style={{ textAlign: "left", padding: "0.75rem" }}>Group</th>
                <th style={{ textAlign: "left", padding: "0.75rem" }}>Role</th>
                <th style={{ textAlign: "right", padding: "0.75rem" }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {userGroups.length === 0 ? (
                <tr>
                  <td colSpan={3} style={{ padding: "0.75rem", color: "var(--text-muted)", textAlign: "center" }}>
                    No user groups assigned.
                  </td>
                </tr>
              ) : null}
              {userGroups.map((ug) => (
                <tr key={ug.user_group_id} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "0.75rem" }}><Link to={`/user-groups/${ug.user_group_id}`}>{ug.name}</Link></td>
                  <td style={{ padding: "0.75rem" }}><span className="badge">{ug.role === "root" || ug.role === "admin" ? "Root" : "User"}</span></td>
                  <td style={{ padding: "0.75rem", textAlign: "right" }}>
                    <button
                      type="button"
                      className="btn-link danger"
                      onClick={async () => {
                        try {
                          const res = await api.delete<{ ok?: boolean; sync_results?: { server_name: string; success: boolean; error?: string }[] }>(
                            `/api/servers/${id}/user-groups/${ug.user_group_id}`
                          );
                          setUserGroups((prev) => prev.filter((g) => g.user_group_id !== ug.user_group_id));
                          loadServer();
                          const sync = res?.sync_results || [];
                          showSuccessModal(sync.length > 0 ? formatSyncResults(sync) : "User group removed.");
                        } catch (e) {
                          setError(e instanceof Error ? e.message : "Failed to remove");
                        }
                      }}
                    disabled={saving}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          </table>
        </div>
        {allUserGroups.filter((g) => !userGroups.some((ug) => ug.user_group_id === g.id)).length > 0 && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!addUserGroupId) return;
              setSaving(true);
              try {
                const res = await api.post<{ ok?: boolean; sync_results?: { server_name: string; success: boolean; error?: string }[] }>(
                  `/api/servers/${id}/user-groups`,
                  { user_group_id: addUserGroupId, role: addUserGroupRole }
                );
                const added = allUserGroups.find((g) => g.id === addUserGroupId);
                setUserGroups((prev) => [...prev, { user_group_id: addUserGroupId, name: added?.name ?? "", role: addUserGroupRole }]);
                setAddUserGroupId("");
                loadServer();
                const sync = res?.sync_results || [];
                showSuccessModal(sync.length > 0 ? formatSyncResults(sync) : "User group added.");
              } catch (e) {
                setError(e instanceof Error ? e.message : "Failed to add");
              } finally {
                setSaving(false);
              }
            }}
            style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "flex-end" }}
          >
            <div className="form-group" style={{ marginBottom: 0, minWidth: "200px" }}>
              <label>Add user group</label>
              <select value={addUserGroupId} onChange={(e) => setAddUserGroupId(e.target.value)}>
                <option value="">Select group…</option>
                {allUserGroups.filter((g) => !userGroups.some((ug) => ug.user_group_id === g.id)).map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: 0, minWidth: "120px" }}>
              <label>Role</label>
              <select value={addUserGroupRole} onChange={(e) => setAddUserGroupRole(e.target.value as "root" | "user")}>
                <option value="user">user</option>
                <option value="root">root</option>
              </select>
            </div>
            <button type="submit" className="primary" disabled={saving || !addUserGroupId}>Add group</button>
          </form>
        )}
      </div>
      </>
      )}
      <DestructiveVerificationModal
        open={deleteServerModalOpen}
        title="Delete Server"
        message={
          server && id
            ? (access.length > 0
                ? `"${server.friendly_name || server.hostname}" has ${access.length} user(s) assigned. They will lose access. Remove this server anyway?`
                : `Remove server "${server.friendly_name || server.hostname}"? This cannot be undone.`)
            : ""
        }
        action="delete_server"
        targetId={id ?? ""}
        targetName={server?.friendly_name || server?.hostname || ""}
        onVerified={doDeleteServer}
        onCancel={() => setDeleteServerModalOpen(false)}
      />
      <ConfirmModal
        open={confirmOpen}
        title={confirmAction?.title || "Confirm"}
        message={confirmAction?.msg || ""}
        confirmLabel="Confirm"
        danger
        onConfirm={async () => {
          setConfirmOpen(false);
          if (confirmAction) await confirmAction.fn();
        }}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
