import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useToast } from "../components/Toast";
import DestructiveVerificationModal from "../components/DestructiveVerificationModal";
import Spinner from "../components/Spinner";

type UserGroupItem = { id: string; name: string; description: string; created_at: string };

export default function UserGroupsList() {
  const { toast } = useToast();
  const [groups, setGroups] = useState<UserGroupItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<UserGroupItem | null>(null);

  const load = () => {
    setLoading(true);
    api
      .get<UserGroupItem[]>("/api/user-groups")
      .then((data) => setGroups(Array.isArray(data) ? data : []))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  };

  useEffect(() => load(), []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      await api.post("/api/user-groups", { name: name.trim(), description: description.trim() || null });
      setName("");
      setDescription("");
      setShowForm(false);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create");
    }
  };

  const requestDelete = (g: UserGroupItem, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setConfirmTarget(g);
    setConfirmOpen(true);
  };

  const doDelete = async (verificationToken: string) => {
    if (!confirmTarget) return;
    setConfirmOpen(false);
    try {
      await api.delete(`/api/user-groups/${confirmTarget.id}`, {
        headers: { "X-Destructive-Verification": verificationToken },
      });
      toast("success", `User group "${confirmTarget.name}" removed.`);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove group");
    }
  };

  return (
    <div className="container app-page">
      <div className="page-header page-header-actions" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "0.75rem" }}>
        <div>
          <Link to="/" className="btn-link">← Dashboard</Link>
          <h1 style={{ marginTop: "0.5rem" }}>User groups</h1>
          <p style={{ color: "var(--text-muted)", fontSize: "0.95rem", marginTop: "0.25rem", marginBottom: 0 }}>
            Create a group of users, then assign the group to a server (with a role). All members get that role on the server.
          </p>
        </div>
        {!showForm && (
          <button type="button" className="primary" onClick={() => setShowForm(true)}>
            Create user group
          </button>
        )}
      </div>
      {error && <p className="error-msg">{error}</p>}
      {showForm && (
        <form onSubmit={handleCreate} className="card" style={{ marginBottom: "1.5rem", maxWidth: "28rem" }}>
          <h2 className="card-subtitle">New user group</h2>
          <div className="form-group">
            <label htmlFor="ug-name">Name</label>
            <input id="ug-name" value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Developers" />
          </div>
          <div className="form-group">
            <label htmlFor="ug-desc">Description (optional)</label>
            <input id="ug-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
          </div>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button type="submit" className="primary">Create</button>
            <button type="button" onClick={() => { setShowForm(false); setName(""); setDescription(""); }}>Cancel</button>
          </div>
        </form>
      )}
      {loading ? (
        <Spinner />
      ) : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Description</th>
                <th>Created</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {groups.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ padding: "1.5rem", color: "var(--text-muted)" }}>
                    No user groups yet. Create one, add members, then assign the group to a server.
                  </td>
                </tr>
              ) : (
                groups.map((g) => (
                  <tr key={g.id}>
                    <td>
                      <Link to={`/user-groups/${g.id}`}>{g.name}</Link>
                    </td>
                    <td style={{ color: "var(--text-muted)" }}>{g.description || "—"}</td>
                    <td style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>
                      {g.created_at ? new Date(g.created_at).toLocaleDateString() : "—"}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <Link to={`/user-groups/${g.id}`} className="btn-sm">Edit</Link>
                      {" "}
                      <button
                        type="button"
                        className="btn-sm btn-outline-danger"
                        onClick={(e) => requestDelete(g, e)}
                        title="Remove user group"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
      <DestructiveVerificationModal
        open={confirmOpen}
        title="Remove User Group"
        message={confirmTarget ? `Remove user group "${confirmTarget.name}"? This will remove the group and its member assignments. This cannot be undone.` : ""}
        action="delete_user_group"
        targetId={confirmTarget?.id ?? ""}
        targetName={confirmTarget?.name ?? ""}
        onVerified={doDelete}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
