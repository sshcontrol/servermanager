import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../api/client";
import { useToast } from "../components/Toast";
import ConfirmModal from "../components/ConfirmModal";
import Spinner from "../components/Spinner";

type ServerGroupDetail = {
  id: string;
  name: string;
  description: string;
  servers: { id: string; hostname: string; friendly_name: string | null }[];
  access: { user_id: string; username: string; role: string }[];
};

type ServerItem = { id: string; hostname: string; friendly_name: string | null; ip_address: string | null };
type UserItem = { id: string; username: string; email: string };

export default function ServerGroupDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const [group, setGroup] = useState<ServerGroupDetail | null>(null);
  const [allServers, setAllServers] = useState<ServerItem[]>([]);
  const [allUsers, setAllUsers] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [addServerId, setAddServerId] = useState("");
  const [addUserId, setAddUserId] = useState("");
  const [addRole, setAddRole] = useState<"admin" | "user">("user");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{ msg: string; fn: () => Promise<void> } | null>(null);

  const load = () => {
    if (!id) return;
    setLoading(true);
    Promise.all([
      api.get<ServerGroupDetail>(`/api/server-groups/${id}`),
      api.get<ServerItem[]>("/api/servers"),
      api.get<{ users: UserItem[] }>("/api/users?limit=500").then((r) => r.users || []),
    ])
      .then(([g, servers, users]) => {
        setGroup(g);
        setEditName(g.name);
        setEditDesc(g.description || "");
        setAllServers(Array.isArray(servers) ? servers : []);
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
      await api.patch(`/api/server-groups/${id}`, { name: editName.trim(), description: editDesc.trim() || null });
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

  const handleAddServer = async () => {
    if (!id || !addServerId) return;
    try {
      const res = await api.post<{ ok?: boolean; sync_results?: { server_name: string; success: boolean; error?: string }[] }>(
        `/api/server-groups/${id}/servers`,
        { server_id: addServerId }
      );
      setAddServerId("");
      load();
      const sync = res?.sync_results || [];
      toast("success", sync.length > 0 ? formatSyncResults(sync) : "Server added.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add server");
    }
  };

  const handleRemoveServer = (serverId: string) => {
    if (!id) return;
    setConfirmAction({
      msg: "Remove this server from the group?",
      fn: async () => {
        try {
          const res = await api.delete<{ ok?: boolean; sync_results?: { server_name: string; success: boolean; error?: string }[] }>(
            `/api/server-groups/${id}/servers/${serverId}`
          );
          load();
          const sync = res?.sync_results || [];
          toast("success", sync.length > 0 ? formatSyncResults(sync) : "Server removed from group.");
        } catch (e) {
          setError(e instanceof Error ? e.message : "Failed to remove");
        }
      },
    });
    setConfirmOpen(true);
  };

  const handleAddUser = async () => {
    if (!id || !addUserId) return;
    try {
      const res = await api.post<{ ok?: boolean; sync_results?: { server_name: string; success: boolean; error?: string }[] }>(
        `/api/server-groups/${id}/access`,
        { user_id: addUserId, role: addRole }
      );
      setAddUserId("");
      load();
      const sync = res?.sync_results || [];
      toast("success", sync.length > 0 ? formatSyncResults(sync) : "User added.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add user");
    }
  };

  const handleSetRole = async (userId: string, role: "admin" | "user") => {
    if (!id) return;
    try {
      const res = await api.post<{ ok?: boolean; sync_results?: { server_name: string; success: boolean; error?: string }[] }>(
        `/api/server-groups/${id}/access`,
        { user_id: userId, role }
      );
      load();
      const sync = res?.sync_results || [];
      toast("success", sync.length > 0 ? formatSyncResults(sync) : "Role updated.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update role");
    }
  };

  const handleRemoveUser = (userId: string) => {
    if (!id) return;
    setConfirmAction({
      msg: "Remove this user from the group?",
      fn: async () => {
        try {
          const res = await api.delete<{ ok?: boolean; sync_results?: { server_name: string; success: boolean; error?: string }[] }>(
            `/api/server-groups/${id}/access/${userId}`
          );
          load();
          const sync = res?.sync_results || [];
          toast("success", sync.length > 0 ? formatSyncResults(sync) : "User removed from group.");
        } catch (e) {
          setError(e instanceof Error ? e.message : "Failed to remove");
        }
      },
    });
    setConfirmOpen(true);
  };

  if (loading || !group) return <div className="container app-page"><Spinner /></div>;
  const serverIdsInGroup = new Set(group.servers.map((s) => s.id));
  const userIdsInGroup = new Set(group.access.map((a) => a.user_id));
  const serversNotInGroup = allServers.filter((s) => !serverIdsInGroup.has(s.id));
  const usersNotInGroup = allUsers.filter((u) => !userIdsInGroup.has(u.id));

  return (
    <div className="container app-page">
      <nav className="breadcrumb">
        <Link to="/server-groups">Server groups</Link>
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
        <h2 className="card-subtitle">Servers in this group</h2>
        <p className="text-muted">Users assigned below have access to all these servers with their group role.</p>
        <ul className="card-list">
          {group.servers.map((s) => (
            <li key={s.id} className="card-list-item" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <Link to={`/server/${s.id}`}>{s.friendly_name || s.hostname}</Link>
              <button type="button" className="secondary small" onClick={() => handleRemoveServer(s.id)}>Remove</button>
            </li>
          ))}
        </ul>
        {serversNotInGroup.length > 0 && (
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem", flexWrap: "wrap" }}>
            <select value={addServerId} onChange={(e) => setAddServerId(e.target.value)}>
              <option value="">Add server…</option>
              {serversNotInGroup.map((s) => (
                <option key={s.id} value={s.id}>{s.friendly_name || s.hostname}</option>
              ))}
            </select>
            <button type="button" className="primary" onClick={handleAddServer} disabled={!addServerId}>Add</button>
          </div>
        )}
      </section>

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <h2 className="card-subtitle">Users in this group (role applies to all servers above)</h2>
        <table className="table">
          <thead>
            <tr>
              <th>User</th>
              <th>Role</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {group.access.map((a) => (
              <tr key={a.user_id}>
                <td>{a.username}</td>
                <td>
                  <select value={a.role} onChange={(e) => handleSetRole(a.user_id, e.target.value as "admin" | "user")}>
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                  </select>
                </td>
                <td><button type="button" className="secondary small" onClick={() => handleRemoveUser(a.user_id)}>Remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {usersNotInGroup.length > 0 && (
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
            <select value={addUserId} onChange={(e) => setAddUserId(e.target.value)}>
              <option value="">Add user…</option>
              {usersNotInGroup.map((u) => (
                <option key={u.id} value={u.id}>{u.username} ({u.email})</option>
              ))}
            </select>
            <select value={addRole} onChange={(e) => setAddRole(e.target.value as "admin" | "user")}>
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
            <button type="button" className="primary" onClick={handleAddUser} disabled={!addUserId}>Add</button>
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
