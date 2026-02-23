import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useToast } from "../components/Toast";
import ConfirmModal from "../components/ConfirmModal";
import Spinner from "../components/Spinner";

type WhitelistEntry = {
  id: string;
  ip_address: string;
  scope: string;
  user_id: string | null;
  username: string | null;
};

type UserOption = { id: string; username: string; email: string };

export default function SecurityWhitelistIp() {
  const [enabled, setEnabled] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [entries, setEntries] = useState<WhitelistEntry[]>([]);
  const [entriesLoading, setEntriesLoading] = useState(true);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [addIp, setAddIp] = useState("");
  const [addScope, setAddScope] = useState<"all" | "user">("all");
  const [addUserId, setAddUserId] = useState("");
  const [addLoading, setAddLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editIp, setEditIp] = useState("");
  const [editScope, setEditScope] = useState<"all" | "user">("all");
  const [editUserId, setEditUserId] = useState("");
  const [editLoading, setEditLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmTargetId, setConfirmTargetId] = useState<string | null>(null);

  const loadSettings = () => {
    setSettingsLoading(true);
    api
      .get<{ enabled: boolean }>("/api/security/whitelist-ip/settings")
      .then((r) => setEnabled(r.enabled))
      .catch(() => setMessage({ type: "error", text: "Failed to load settings" }))
      .finally(() => setSettingsLoading(false));
  };

  const loadEntries = () => {
    setEntriesLoading(true);
    api
      .get<WhitelistEntry[]>("/api/security/whitelist-ip/entries")
      .then(setEntries)
      .catch(() => setMessage({ type: "error", text: "Failed to load whitelist" }))
      .finally(() => setEntriesLoading(false));
  };

  const loadUsers = () => {
    api
      .get<{ users: { id: string; username: string; email: string }[] }>("/api/users?limit=500")
      .then((r) => setUsers(r.users || []))
      .catch(() => {});
  };

  useEffect(() => {
    loadSettings();
    loadEntries();
    loadUsers();
  }, []);

  const handleToggle = async () => {
    setMessage(null);
    setSettingsLoading(true);
    try {
      const r = await api.patch<{ enabled: boolean }>("/api/security/whitelist-ip/settings", {
        enabled: !enabled,
      });
      setEnabled(r.enabled);
      setMessage({
        type: "success",
        text: r.enabled ? "IP whitelist enabled. Only whitelisted IPs can access." : "IP whitelist disabled. Any IP can access.",
      });
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : "Failed to update settings" });
    } finally {
      setSettingsLoading(false);
    }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    const ip = addIp.trim();
    if (!ip) {
      setMessage({ type: "error", text: "Enter an IP address" });
      return;
    }
    if (addScope === "user" && !addUserId) {
      setMessage({ type: "error", text: "Select a user when scope is specific user" });
      return;
    }
    setAddLoading(true);
    try {
      await api.post("/api/security/whitelist-ip/entries", {
        ip_address: ip,
        scope: addScope,
        user_id: addScope === "user" ? addUserId : null,
      });
      setMessage({ type: "success", text: "IP added to whitelist" });
      setAddIp("");
      setAddUserId("");
      loadEntries();
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : "Failed to add entry" });
    } finally {
      setAddLoading(false);
    }
  };

  const startEdit = (entry: WhitelistEntry) => {
    setEditingId(entry.id);
    setEditIp(entry.ip_address);
    setEditScope((entry.scope as "all" | "user") || "all");
    setEditUserId(entry.user_id || "");
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingId) return;
    setMessage(null);
    const ip = editIp.trim();
    if (!ip) {
      setMessage({ type: "error", text: "Enter an IP address" });
      return;
    }
    if (editScope === "user" && !editUserId) {
      setMessage({ type: "error", text: "Select a user when scope is specific user" });
      return;
    }
    setEditLoading(true);
    try {
      await api.patch(`/api/security/whitelist-ip/entries/${editingId}`, {
        ip_address: ip,
        scope: editScope,
        user_id: editScope === "user" ? editUserId : null,
      });
      setMessage({ type: "success", text: "Entry updated" });
      setEditingId(null);
      loadEntries();
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : "Failed to update" });
    } finally {
      setEditLoading(false);
    }
  };

  const requestDelete = (id: string) => {
    setConfirmTargetId(id);
    setConfirmOpen(true);
  };

  const doDelete = async () => {
    if (!confirmTargetId) return;
    setConfirmOpen(false);
    setDeletingId(confirmTargetId);
    setMessage(null);
    try {
      await api.delete(`/api/security/whitelist-ip/entries/${confirmTargetId}`);
      toast("success", "Entry removed");
      loadEntries();
      if (editingId === confirmTargetId) setEditingId(null);
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : "Failed to delete" });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="container app-page">
      <div className="page-header">
        <h1>Whitelist IP</h1>
        <Link to="/" className="btn-link">← Dashboard</Link>
      </div>

      <p style={{ color: "var(--text-muted)", fontSize: "0.95rem", marginBottom: "1.5rem" }}>
        When enabled, users can SSH to servers only from a whitelisted IP. Add IPs for all users or for a specific user. Panel login is not restricted.
      </p>

      {message && (
        <p className={message.type === "error" ? "error-msg" : "success-msg"} style={{ marginBottom: "1rem" }}>
          {message.text}
        </p>
      )}

      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <h2 className="card-subtitle">IP whitelist</h2>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
          <span style={{ fontWeight: 500 }}>
            {enabled ? "Enabled — users can SSH to servers only from whitelisted IPs" : "Disabled — users can SSH from any IP"}
          </span>
          <button
            type="button"
            className={enabled ? "btn-outline" : "primary"}
            onClick={handleToggle}
            disabled={settingsLoading}
          >
            {settingsLoading ? "…" : enabled ? "Disable" : "Enable"}
          </button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <h2 className="card-subtitle">Add IP address</h2>
        <form onSubmit={handleAdd} style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "flex-end" }}>
          <div className="form-group" style={{ marginBottom: 0, minWidth: "160px" }}>
            <label htmlFor="add-ip">IP address</label>
            <input
              id="add-ip"
              type="text"
              value={addIp}
              onChange={(e) => setAddIp(e.target.value)}
              placeholder="e.g. 192.168.1.1"
            />
          </div>
          <div className="form-group" style={{ marginBottom: 0, minWidth: "140px" }}>
            <label htmlFor="add-scope">Scope</label>
            <select
              id="add-scope"
              value={addScope}
              onChange={(e) => setAddScope(e.target.value as "all" | "user")}
            >
              <option value="all">All users</option>
              <option value="user">Specific user</option>
            </select>
          </div>
          {addScope === "user" && (
            <div className="form-group" style={{ marginBottom: 0, minWidth: "180px" }}>
              <label htmlFor="add-user">User</label>
              <select
                id="add-user"
                value={addUserId}
                onChange={(e) => setAddUserId(e.target.value)}
                required={addScope === "user"}
              >
                <option value="">Select user</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.username} ({u.email})</option>
                ))}
              </select>
            </div>
          )}
          <button type="submit" className="primary" disabled={addLoading}>
            {addLoading ? "Adding…" : "Add"}
          </button>
        </form>
      </div>

      <div className="card">
        <h2 className="card-subtitle">Whitelist entries</h2>
        {entriesLoading ? (
          <Spinner />
        ) : entries.length === 0 ? (
          <p style={{ color: "var(--text-muted)" }}>No entries yet. Add an IP above.</p>
        ) : (
          <div className="table-wrap">
            <table className="table" style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  <th style={{ textAlign: "left", padding: "0.75rem" }}>IP address</th>
                  <th style={{ textAlign: "left", padding: "0.75rem" }}>Scope</th>
                  <th style={{ textAlign: "left", padding: "0.75rem" }}>User</th>
                  <th style={{ textAlign: "right", padding: "0.75rem" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id} style={{ borderBottom: "1px solid var(--border)" }}>
                    {editingId === entry.id ? (
                      <>
                        <td colSpan={4} style={{ padding: "0.75rem" }}>
                          <form onSubmit={handleUpdate} style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center" }}>
                            <input
                              type="text"
                              value={editIp}
                              onChange={(e) => setEditIp(e.target.value)}
                              placeholder="IP address"
                              style={{ width: "140px" }}
                              required
                            />
                            <select
                              value={editScope}
                              onChange={(e) => setEditScope(e.target.value as "all" | "user")}
                            >
                              <option value="all">All users</option>
                              <option value="user">Specific user</option>
                            </select>
                            {editScope === "user" && (
                              <select
                                value={editUserId}
                                onChange={(e) => setEditUserId(e.target.value)}
                                style={{ minWidth: "140px" }}
                                required={editScope === "user"}
                              >
                                <option value="">Select user</option>
                                {users.map((u) => (
                                  <option key={u.id} value={u.id}>{u.username}</option>
                                ))}
                              </select>
                            )}
                            <button type="submit" className="primary" disabled={editLoading}>
                              {editLoading ? "…" : "Save"}
                            </button>
                            <button
                              type="button"
                              className="btn-outline"
                              onClick={() => setEditingId(null)}
                            >
                              Cancel
                            </button>
                          </form>
                        </td>
                      </>
                    ) : (
                      <>
                        <td style={{ padding: "0.75rem" }}><code>{entry.ip_address}</code></td>
                        <td style={{ padding: "0.75rem" }}>
                          {entry.scope === "all" ? "All users" : "Specific user"}
                        </td>
                        <td style={{ padding: "0.75rem" }}>{entry.username ?? entry.user_id ?? "—"}</td>
                        <td style={{ padding: "0.75rem", textAlign: "right" }}>
                          <button
                            type="button"
                            className="btn-outline"
                            onClick={() => startEdit(entry)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="btn-outline"
                            style={{ marginLeft: "0.5rem", color: "var(--danger, #c00)" }}
                            onClick={() => requestDelete(entry.id)}
                            disabled={deletingId === entry.id}
                          >
                            {deletingId === entry.id ? "…" : "Remove"}
                          </button>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <ConfirmModal
        open={confirmOpen}
        title="Remove IP"
        message="Remove this IP from the whitelist?"
        confirmLabel="Remove"
        danger
        onConfirm={doDelete}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
