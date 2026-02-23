import { useState, useEffect } from "react";
import { api } from "../api/client";
import { COUNTRY_CODES, toE164, isValidE164 } from "../lib/phone";

type UserRow = {
  id: string;
  email: string;
  username: string;
  phone?: string | null;
  is_active: boolean;
  is_superuser: boolean;
  totp_enabled: boolean;
  created_at: string;
  roles: { id: string; name: string }[];
};

type RoleOption = {
  id: string;
  name: string;
  description: string | null;
};

export default function AdminUsers() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [skip, setSkip] = useState(0);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [createForm, setCreateForm] = useState({
    email: "",
    username: "",
    password: "",
    phoneCountryCode: "+1",
    phoneNumber: "",
    role_ids: [] as string[],
  });
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editRoleIds, setEditRoleIds] = useState<string[]>([]);
  const [editLoading, setEditLoading] = useState(false);
  const limit = 20;

  const loadUsers = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.get<{ users: UserRow[]; total: number }>(
        `/api/users?skip=${skip}&limit=${limit}`
      );
      setUsers(res.users);
      setTotal(res.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, [skip]);

  useEffect(() => {
    if (showCreateForm && roles.length === 0) {
      api
        .get<RoleOption[]>("/api/roles")
        .then(setRoles)
        .catch(() => setRoles([]));
    }
  }, [showCreateForm, roles.length]);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    if (!createForm.email.trim() || !createForm.username.trim() || !createForm.password) {
      setMessage({ type: "error", text: "Email, username and password are required." });
      return;
    }
    const phone = createForm.phoneNumber.trim() ? toE164(createForm.phoneCountryCode, createForm.phoneNumber) : null;
    if (phone && !isValidE164(phone)) {
      setMessage({ type: "error", text: "Please enter a valid phone number with country code." });
      return;
    }
    if (createForm.password.length < 8) {
      setMessage({ type: "error", text: "Password must be at least 8 characters." });
      return;
    }
    setCreateLoading(true);
    try {
      const payload: Record<string, unknown> = {
        email: createForm.email.trim(),
        username: createForm.username.trim(),
        password: createForm.password,
        role_ids: createForm.role_ids,
      };
      if (phone) payload.phone = phone;
      await api.post("/api/users", payload);
      setMessage({ type: "success", text: "User created successfully." });
      setCreateForm({ email: "", username: "", password: "", phoneCountryCode: "+1", phoneNumber: "", role_ids: [] });
      setShowCreateForm(false);
      loadUsers();
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : "Failed to create user" });
    } finally {
      setCreateLoading(false);
    }
  };

  const toggleRole = (roleId: string) => {
    setCreateForm((prev) => ({
      ...prev,
      role_ids: prev.role_ids.includes(roleId)
        ? prev.role_ids.filter((id) => id !== roleId)
        : [...prev.role_ids, roleId],
    }));
  };

  const startEditUser = (user: UserRow) => {
    setEditingUserId(user.id);
    setEditRoleIds(user.roles.map((r) => r.id));
    if (roles.length === 0) {
      api.get<RoleOption[]>("/api/roles").then(setRoles).catch(() => setRoles([]));
    }
  };

  const toggleEditRole = (roleId: string) => {
    setEditRoleIds((prev) =>
      prev.includes(roleId) ? prev.filter((id) => id !== roleId) : [...prev, roleId]
    );
  };

  const handleUpdateUserRoles = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUserId) return;
    setMessage(null);
    setEditLoading(true);
    try {
      await api.patch(`/api/users/${editingUserId}`, { role_ids: editRoleIds });
      setMessage({ type: "success", text: "User roles updated." });
      setEditingUserId(null);
      loadUsers();
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : "Failed to update user" });
    } finally {
      setEditLoading(false);
    }
  };

  return (
    <div className="container app-page">
      <div className="page-header page-header-actions">
        <h1>Users</h1>
        <button
          type="button"
          className="primary"
          onClick={() => {
            setShowCreateForm(!showCreateForm);
            setMessage(null);
          }}
        >
          {showCreateForm ? "Cancel" : "Create user"}
        </button>
      </div>

      {message && (
        <p className={message.type === "error" ? "error-msg" : "success-msg"} style={{ marginBottom: "1rem" }}>
          {message.text}
        </p>
      )}

      {showCreateForm && (
        <div className="card" style={{ marginBottom: "1.5rem" }}>
          <h2 style={{ fontSize: "1.1rem", marginBottom: "1rem" }}>Create user</h2>
          <form onSubmit={handleCreateUser}>
            <div className="form-group">
              <label htmlFor="create-email">Email</label>
              <input
                id="create-email"
                type="email"
                value={createForm.email}
                onChange={(e) => setCreateForm((f) => ({ ...f, email: e.target.value }))}
                required
                placeholder="user@example.com"
              />
            </div>
            <div className="form-group">
              <label htmlFor="create-username">Username</label>
              <input
                id="create-username"
                type="text"
                value={createForm.username}
                onChange={(e) => setCreateForm((f) => ({ ...f, username: e.target.value }))}
                required
                minLength={2}
                maxLength={100}
                placeholder="username"
              />
            </div>
            <div className="form-group">
              <label htmlFor="create-phone">Phone <span style={{ color: "var(--text-muted)", fontWeight: "normal" }}>— optional</span></label>
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
                <select
                  id="create-phone"
                  value={createForm.phoneCountryCode}
                  onChange={(e) => setCreateForm((f) => ({ ...f, phoneCountryCode: e.target.value }))}
                  style={{ minWidth: "120px" }}
                >
                  {COUNTRY_CODES.map((c) => (
                    <option key={c.code} value={c.code}>{c.label}</option>
                  ))}
                </select>
                <input
                  type="tel"
                  value={createForm.phoneNumber}
                  onChange={(e) => setCreateForm((f) => ({ ...f, phoneNumber: e.target.value.replace(/\D/g, "").slice(0, 15) }))}
                  placeholder="2345678900"
                  style={{ flex: "1", minWidth: "140px" }}
                />
              </div>
            </div>
            <div className="form-group">
              <label htmlFor="create-password">Password</label>
              <input
                id="create-password"
                type="password"
                value={createForm.password}
                onChange={(e) => setCreateForm((f) => ({ ...f, password: e.target.value }))}
                required
                minLength={8}
                placeholder="Min 8 characters"
              />
            </div>
            <div className="form-group">
              <label>Roles</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", marginTop: "0.35rem" }}>
                {roles.length === 0 && showCreateForm ? (
                  <span style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>Loading roles…</span>
                ) : (
                  roles.map((r) => (
                    <label key={r.id} style={{ display: "flex", alignItems: "center", gap: "0.35rem", cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={createForm.role_ids.includes(r.id)}
                        onChange={() => toggleRole(r.id)}
                      />
                      <span>{r.name}</span>
                      {r.description && (
                        <span style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>({r.description})</span>
                      )}
                    </label>
                  ))
                )}
              </div>
            </div>
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
              <button type="submit" className="primary" disabled={createLoading}>
                {createLoading ? "Creating…" : "Create user"}
              </button>
              <button type="button" onClick={() => setShowCreateForm(false)}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {editingUserId && (
        <div className="card" style={{ marginBottom: "1.5rem" }}>
          <h2 style={{ fontSize: "1.1rem", marginBottom: "1rem" }}>Edit user roles</h2>
          <form onSubmit={handleUpdateUserRoles}>
            <div className="form-group">
              <label>Roles</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", marginTop: "0.35rem" }}>
                {roles.map((r) => (
                  <label key={r.id} style={{ display: "flex", alignItems: "center", gap: "0.35rem", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={editRoleIds.includes(r.id)}
                      onChange={() => toggleEditRole(r.id)}
                    />
                    <span>{r.name}</span>
                  </label>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
              <button type="submit" className="primary" disabled={editLoading}>
                {editLoading ? "Saving…" : "Save roles"}
              </button>
              <button type="button" onClick={() => setEditingUserId(null)}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {error && <p className="error-msg">{error}</p>}
      {loading ? (
        <p style={{ color: "var(--text-muted)" }}>Loading…</p>
      ) : (
        <>
          <div className="card table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Username</th>
                  <th>Email</th>
                  <th>Roles</th>
                  <th>2FA</th>
                  <th>Active</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>{u.username}</td>
                    <td>{u.email}</td>
                    <td>{u.roles.map((r) => r.name).join(", ") || "—"}</td>
                    <td>{u.totp_enabled ? "Yes" : "No"}</td>
                    <td>{u.is_active ? "Yes" : "No"}</td>
                    <td>
                      <button
                        type="button"
                        style={{ fontSize: "0.85rem", padding: "0.25rem 0.5rem" }}
                        onClick={() => startEditUser(u)}
                      >
                        Edit roles
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ marginTop: "0.75rem", color: "var(--text-muted)", fontSize: "0.9rem" }}>
            {total === 0 ? "No users found" : `Showing ${skip + 1}–${Math.min(skip + limit, total)} of ${total}`}
          </p>
          <div style={{ marginTop: "0.5rem", display: "flex", gap: "0.5rem" }}>
            <button type="button" disabled={skip === 0} onClick={() => setSkip((s) => Math.max(0, s - limit))}>
              Previous
            </button>
            <button type="button" disabled={skip + limit >= total} onClick={() => setSkip((s) => s + limit)}>
              Next
            </button>
          </div>
        </>
      )}
    </div>
  );
}
