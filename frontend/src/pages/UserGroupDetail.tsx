import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../api/client";
import { useToast } from "../components/Toast";
import ConfirmModal from "../components/ConfirmModal";
import Spinner from "../components/Spinner";

type UserGroupDetail = {
  id: string;
  name: string;
  description: string;
  members: { user_id: string; username: string; email: string }[];
};

type UserItem = { id: string; username: string; email: string };

export default function UserGroupDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const [group, setGroup] = useState<UserGroupDetail | null>(null);
  const [allUsers, setAllUsers] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [addUserId, setAddUserId] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{ msg: string; fn: () => Promise<void> } | null>(null);

  const load = () => {
    if (!id) return;
    setLoading(true);
    Promise.all([
      api.get<UserGroupDetail>(`/api/user-groups/${id}`),
      api.get<{ users: UserItem[] }>("/api/users?limit=500").then((r) => r.users || []),
    ])
      .then(([g, users]) => {
        setGroup(g);
        setEditName(g.name);
        setEditDesc(g.description || "");
        setAllUsers(Array.isArray(users) ? users : []);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  };

  useEffect(() => load(), [id]);

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id) return;
    try {
      await api.patch(`/api/user-groups/${id}`, { name: editName.trim(), description: editDesc.trim() || null });
      setEditing(false);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update");
    }
  };

  const formatSyncResults = (results: { server_name: string; success: boolean; error?: string }[]) => {
    const ok = results.filter((r) => r.success);
    const fail = results.filter((r) => !r.success);
    if (fail.length === 0) return `Sync completed on ${ok.length} server(s).`;
    if (ok.length === 0) return `Sync failed: ${fail.map((r) => r.error || "Unknown").join("; ")}`;
    return `${ok.length} synced, ${fail.length} failed.`;
  };

  const handleAddMember = async () => {
    if (!id || !addUserId) return;
    try {
      const res = await api.post<{ ok?: boolean; sync_results?: { server_name: string; success: boolean; error?: string }[] }>(
        `/api/user-groups/${id}/members`,
        { user_id: addUserId }
      );
      setAddUserId("");
      load();
      const sync = res?.sync_results || [];
      toast("success", sync.length > 0 ? formatSyncResults(sync) : "Member added.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add member");
    }
  };

  const handleRemoveMember = (userId: string) => {
    if (!id) return;
    setConfirmAction({
      msg: "Remove this user from the group?",
      fn: async () => {
        try {
          const res = await api.delete<{ ok?: boolean; sync_results?: { server_name: string; success: boolean; error?: string }[] }>(
            `/api/user-groups/${id}/members/${userId}`
          );
          load();
          const sync = res?.sync_results || [];
          toast("success", sync.length > 0 ? formatSyncResults(sync) : "Member removed from group.");
        } catch (e) {
          setError(e instanceof Error ? e.message : "Failed to remove");
        }
      },
    });
    setConfirmOpen(true);
  };

  if (loading || !group) return <div className="container app-page"><Spinner /></div>;
  const memberIds = new Set(group.members.map((m) => m.user_id));
  const usersNotInGroup = allUsers.filter((u) => !memberIds.has(u.id));

  return (
    <div className="container app-page">
      <nav className="breadcrumb">
        <Link to="/user-groups">User groups</Link>
        <span>{group.name}</span>
      </nav>
      <h1 className="app-page-title">{group.name}</h1>
      {group.description && <p className="text-muted">{group.description}</p>}
      {error && <p className="error-msg">{error}</p>}

      {!editing ? (
        <p><button type="button" className="secondary" onClick={() => setEditing(true)}>Edit name & description</button></p>
      ) : (
        <form onSubmit={handleUpdate} className="card" style={{ marginBottom: "1rem", maxWidth: "28rem" }}>
          <div className="form-group">
            <label>Name</label>
            <input value={editName} onChange={(e) => setEditName(e.target.value)} required />
          </div>
          <div className="form-group">
            <label>Description</label>
            <input value={editDesc} onChange={(e) => setEditDesc(e.target.value)} />
          </div>
          <button type="submit" className="primary">Save</button>
          <button type="button" className="secondary" onClick={() => setEditing(false)}>Cancel</button>
        </form>
      )}

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <h2 className="card-subtitle">Members</h2>
        <p className="text-muted">Assign this group to a server (from the server’s page) to give all members access.</p>
        <ul className="card-list">
          {group.members.map((m) => (
            <li key={m.user_id} className="card-list-item" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>{m.username} ({m.email})</span>
              <button type="button" className="secondary small" onClick={() => handleRemoveMember(m.user_id)}>Remove</button>
            </li>
          ))}
        </ul>
        {usersNotInGroup.length > 0 && (
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem", flexWrap: "wrap" }}>
            <select value={addUserId} onChange={(e) => setAddUserId(e.target.value)}>
              <option value="">Add member…</option>
              {usersNotInGroup.map((u) => (
                <option key={u.id} value={u.id}>{u.username} ({u.email})</option>
              ))}
            </select>
            <button type="button" className="primary" onClick={handleAddMember} disabled={!addUserId}>Add</button>
          </div>
        )}
      </section>
      <ConfirmModal
        open={confirmOpen}
        title="Confirm"
        message={confirmAction?.msg || ""}
        confirmLabel="Remove"
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
