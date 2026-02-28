import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../components/Toast";
import DestructiveVerificationModal from "../components/DestructiveVerificationModal";
import Spinner from "../components/Spinner";
import { normalizeToE164, isValidE164 } from "../lib/phone";

type UserRow = {
  id: string;
  email: string;
  username: string;
  phone?: string | null;
  phone_verified?: boolean;
  is_active: boolean;
  is_superuser: boolean;
  totp_enabled: boolean;
  onboarding_completed?: boolean;
  needs_initial_password?: boolean;
  created_at: string;
  roles: { id: string; name: string }[];
  server_access?: { server_id: string; role: string }[];
};
type RoleOption = { id: string; name: string; description: string | null };
type ServerItem = { id: string; hostname: string; friendly_name: string | null; ip_address: string | null; description: string | null; status: string };

export default function ModifyUsers() {
  const { user: currentUser } = useAuth();
  const { toast } = useToast();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [servers, setServers] = useState<ServerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [skip, setSkip] = useState(0);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editUsername, setEditUsername] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editRoleIds, setEditRoleIds] = useState<string[]>([]);
  const [editServerAccess, setEditServerAccess] = useState<Record<string, "admin" | "user">>({});
  const [editIsActive, setEditIsActive] = useState(true);
  const [editTotpEnabled, setEditTotpEnabled] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [editPhone, setEditPhone] = useState("");
  const [editPhoneVerified, setEditPhoneVerified] = useState(false);
  const [editPhoneStep, setEditPhoneStep] = useState<"enter" | "verify">("enter");
  const [editPhoneVerifyCode, setEditPhoneVerifyCode] = useState("");
  const [editPhoneLoading, setEditPhoneLoading] = useState(false);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const [resendWelcomeUserId, setResendWelcomeUserId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const limit = 20;

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<UserRow | null>(null);

  const [invitations, setInvitations] = useState<{ id: string; email: string; role_name: string; accepted: boolean; expires_at: string; invited_by_name: string | null }[]>([]);

  const requestDeleteUser = (u: UserRow) => {
    setConfirmTarget(u);
    setConfirmOpen(true);
  };

  const doDeleteUser = async (verificationToken: string) => {
    if (!confirmTarget) return;
    setConfirmOpen(false);
    const u = confirmTarget;
    setDeletingUserId(u.id);
    try {
      await api.delete(`/api/users/${u.id}`, {
        headers: { "X-Destructive-Verification": verificationToken },
      });
      toast("success", "User deleted.");
      loadUsers();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Failed to delete user");
    } finally {
      setDeletingUserId(null);
    }
  };

  const loadInvitations = async () => {
    try {
      const res = await api.get<{ invitations: typeof invitations }>("/api/users/invitations");
      setInvitations(res.invitations || []);
    } catch { /* ignore */ }
  };

  const cancelInvitation = async (id: string) => {
    try {
      await api.delete(`/api/users/invitations/${id}`);
      toast("success", "Invitation cancelled.");
      loadInvitations();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Failed to cancel invitation");
    }
  };

  const resendWelcome = async (u: UserRow) => {
    if (!u.needs_initial_password) return;
    setResendWelcomeUserId(u.id);
    try {
      await api.post(`/api/users/${u.id}/resend-welcome`);
      toast("success", `Password reset link sent to ${u.email}.`);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Failed to send link");
    } finally {
      setResendWelcomeUserId(null);
    }
  };

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
    loadInvitations();
  }, [skip]);

  useEffect(() => {
    if (editingUserId) {
      if (roles.length === 0) api.get<RoleOption[]>("/api/roles").then(setRoles).catch(() => setRoles([]));
      if (servers.length === 0) api.get<ServerItem[]>("/api/servers").then((d) => setServers(Array.isArray(d) ? d : [])).catch(() => setServers([]));
    }
  }, [editingUserId, roles.length, servers.length]);

  const startEditUser = async (user: UserRow) => {
    setEditingUserId(user.id);
    setEditUsername(user.username);
    setEditEmail(user.email);
    setEditRoleIds(user.roles.map((r) => r.id));
    setEditIsActive(user.is_active);
    setEditTotpEnabled(user.totp_enabled);
    setEditPhone(user.phone ?? "");
    setEditPhoneVerified(user.phone_verified ?? false);
    setEditPhoneStep("enter");
    setEditPhoneVerifyCode("");
    const acc: Record<string, "admin" | "user"> = {};
    (user.server_access || []).forEach((a) => { if (a.role === "admin" || a.role === "user") acc[a.server_id] = a.role; });
    setEditServerAccess(acc);
    try {
      const fresh = await api.get<UserRow>(`/api/users/${user.id}`);
      setEditUsername(fresh.username);
      setEditEmail(fresh.email);
      setEditRoleIds(fresh.roles.map((r) => r.id));
      setEditIsActive(fresh.is_active);
      setEditTotpEnabled(fresh.totp_enabled);
      setEditPhone(fresh.phone ?? "");
      setEditPhoneVerified(fresh.phone_verified ?? false);
      const freshAcc: Record<string, "admin" | "user"> = {};
      (fresh.server_access || []).forEach((a) => { if (a.role === "admin" || a.role === "user") freshAcc[a.server_id] = a.role; });
      setEditServerAccess(freshAcc);
    } catch {
      // keep initial values if fetch fails
    }
  };

  const requestEditPhoneCode = async () => {
    if (!editingUserId) return;
    const phone = editPhone.trim() ? normalizeToE164(editPhone) : "";
    if (!phone || !isValidE164(phone)) {
      setMessage({ type: "error", text: "Enter a valid phone number." });
      return;
    }
    setEditPhoneLoading(true);
    setMessage(null);
    try {
      await api.post(`/api/users/${editingUserId}/request-phone-verification`, { phone });
      setMessage({ type: "success", text: "Verification code sent." });
      setEditPhoneStep("verify");
      setEditPhoneVerifyCode("");
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : "Failed to send code" });
    } finally {
      setEditPhoneLoading(false);
    }
  };

  const verifyEditPhone = async () => {
    if (!editingUserId) return;
    const phone = editPhone.trim() ? normalizeToE164(editPhone) : "";
    if (!phone || !isValidE164(phone) || editPhoneVerifyCode.length < 4) return;
    setEditPhoneLoading(true);
    setMessage(null);
    try {
      await api.post(`/api/users/${editingUserId}/verify-phone`, { phone, code: editPhoneVerifyCode });
      setMessage({ type: "success", text: "Phone verified." });
      setEditPhoneStep("enter");
      setEditPhoneVerifyCode("");
      setEditPhoneVerified(true);
      loadUsers();
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : "Verification failed" });
    } finally {
      setEditPhoneLoading(false);
    }
  };

  const toggleEditRole = (roleId: string) => {
    setEditRoleIds((prev) =>
      prev.includes(roleId) ? prev.filter((id) => id !== roleId) : [...prev, roleId]
    );
  };

  const formatSyncResults = (results: { server_name: string; success: boolean; error?: string }[]) => {
    const ok = results.filter((r) => r.success);
    const fail = results.filter((r) => !r.success);
    if (fail.length === 0) return `Sync completed on ${ok.length} server(s).`;
    if (ok.length === 0) return `Sync failed: ${fail.map((r) => r.error || "Unknown").join("; ")}`;
    return `${ok.length} synced, ${fail.length} failed: ${fail.map((r) => r.error).join("; ")}`;
  };

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUserId) return;
    if (!editUsername.trim() || !editEmail.trim()) {
      setMessage({ type: "error", text: "Username and email are required." });
      return;
    }
    setMessage(null);
    setEditLoading(true);
    try {
      const server_access = Object.entries(editServerAccess)
        .filter(([, role]) => role === "admin" || role === "user")
        .map(([server_id, role]) => ({ server_id, role }));
      const res = await api.patch<{ sync_results?: { server_name: string; success: boolean; error?: string }[] }>(
        `/api/users/${editingUserId}`,
        {
          username: editUsername.trim(),
          email: editEmail.trim(),
          is_active: editIsActive,
          totp_enabled: editTotpEnabled,
          role_ids: editRoleIds,
          server_access,
        }
      );
      const sync = res?.sync_results || [];
      const syncMsg = sync.length > 0 ? formatSyncResults(sync) : "User updated.";
      toast("success", syncMsg);
      setEditingUserId(null);
      loadUsers();
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : "Failed to update user" });
    } finally {
      setEditLoading(false);
    }
  };

  const filtered = users.filter((u) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      u.username.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      u.roles.some((r) => r.name.toLowerCase().includes(q))
    );
  });

  const totalPages = Math.ceil(total / limit) || 1;
  const currentPage = Math.floor(skip / limit) + 1;

  return (
    <div className="container app-page">
      <div className="page-header page-header-actions">
        <h1>Modify users</h1>
        <div className="page-actions">
          {!editingUserId && !loading && users.length > 0 && (
            <input
              type="text"
              placeholder="Search users…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: "100%", maxWidth: 220, padding: "0.4rem 0.7rem", fontSize: "0.9rem" }}
            />
          )}
          <Link to="/users/add" className="primary" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", padding: "0.5rem 1rem" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6 }}><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
            Add User
          </Link>
        </div>
      </div>
      {message && (
        <p className={message.type === "error" ? "error-msg" : "success-msg"} style={{ marginBottom: "1rem" }}>
          {message.text}
        </p>
      )}
      {editingUserId ? (
        <div className="card card-form" style={{ marginBottom: "1.5rem", maxWidth: 560 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem", marginBottom: "1rem" }}>
            <h2 className="card-subtitle" style={{ marginBottom: 0 }}>Edit user</h2>
            <button type="button" className="btn-outline" onClick={() => setEditingUserId(null)}>← Back to users</button>
          </div>
          <form onSubmit={handleUpdateUser}>
            <div className="form-group">
              <label htmlFor="edit-username">Username</label>
              <input id="edit-username" type="text" value={editUsername} onChange={(e) => setEditUsername(e.target.value)} required minLength={2} maxLength={100} />
            </div>
            <div className="form-group">
              <label htmlFor="edit-email">Email</label>
              <input id="edit-email" type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} required />
            </div>
            <div className="form-group">
              <label className="edit-user-section-label">Status</label>
              <div className="form-check-group form-check-group-vertical">
                <label htmlFor="edit-is-active" className="form-check-label">
                  <input id="edit-is-active" type="checkbox" checked={editIsActive} onChange={(e) => setEditIsActive(e.target.checked)} />
                  <span>Active (user can log in)</span>
                </label>
                <label htmlFor="edit-totp-enabled" className="form-check-label">
                  <input id="edit-totp-enabled" type="checkbox" checked={editTotpEnabled} onChange={(e) => setEditTotpEnabled(e.target.checked)} />
                  <span>2FA enabled (uncheck to disable 2FA for this user)</span>
                </label>
              </div>
            </div>
            <div className="form-group">
              <label className="edit-user-section-label">Phone</label>
              {editPhoneVerified ? (
                <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>
                  Verified: {editPhone || "—"}. Only platform admin can change verified phone.
                </p>
              ) : (
                <div>
                  <div style={{ marginBottom: "0.5rem" }}>
                    <input
                      type="tel"
                      value={editPhone}
                      onChange={(e) => setEditPhone(e.target.value.replace(/[^\d+]/g, "").slice(0, 16))}
                      placeholder="+32xxx for country and phone format"
                      style={{ width: "100%", maxWidth: 280 }}
                      disabled={editPhoneStep === "verify"}
                    />
                  </div>
                  {editPhoneStep === "verify" && (
                    <div style={{ marginBottom: "0.5rem" }}>
                      <input type="text" value={editPhoneVerifyCode} onChange={(e) => setEditPhoneVerifyCode(e.target.value.replace(/\D/g, "").slice(0, 8))} placeholder="0000" maxLength={8} inputMode="numeric" style={{ width: 120 }} />
                    </div>
                  )}
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    {editPhoneStep === "verify" ? (
                      <button type="button" className="btn-outline" onClick={verifyEditPhone} disabled={editPhoneLoading || editPhoneVerifyCode.length < 4}>
                        {editPhoneLoading ? "Verifying…" : "Verify"}
                      </button>
                    ) : (
                      <button type="button" className="btn-outline" onClick={requestEditPhoneCode} disabled={editPhoneLoading || !editPhone.trim()}>
                        {editPhoneLoading ? "Sending…" : "Send verification code"}
                      </button>
                    )}
                    {editPhoneStep === "verify" && (
                      <button type="button" className="btn-outline" onClick={() => { setEditPhoneStep("enter"); setEditPhoneVerifyCode(""); }}>Back</button>
                    )}
                  </div>
                </div>
              )}
            </div>
            <div className="form-group">
              <label className="edit-user-section-label">Roles</label>
              <div className="form-check-group form-check-group-vertical">
                {roles.map((r) => (
                  <label key={r.id} className="form-check-label">
                    <input type="checkbox" checked={editRoleIds.includes(r.id)} onChange={() => toggleEditRole(r.id)} />
                    <span>{r.name}</span>
                  </label>
                ))}
              </div>
            </div>
            {servers.length > 0 && (
              <div className="form-group">
                <label className="edit-user-section-label">Server access</label>
                <p className="text-muted text-sm mb-1">Admin = can manage access on that server; User = view/use.</p>
                <div className="edit-user-server-access">
                  {servers.map((s) => (
                    <div key={s.id} className="edit-user-server-row">
                      <span className="edit-user-server-name">{s.friendly_name || s.hostname}</span>
                      <select
                        value={editServerAccess[s.id] || ""}
                        onChange={(e) => {
                          const v = e.target.value as "" | "admin" | "user";
                          setEditServerAccess((prev) =>
                            v ? { ...prev, [s.id]: v } : (() => { const { [s.id]: _, ...rest } = prev; return rest; })()
                          );
                        }}
                      >
                        <option value="">No access</option>
                        <option value="user">User</option>
                        <option value="admin">Admin</option>
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="edit-user-actions">
              <button type="submit" className="primary" disabled={editLoading}>
                {editLoading ? "Saving…" : "Save"}
              </button>
              <button type="button" className="btn-outline" onClick={() => setEditingUserId(null)}>Cancel</button>
            </div>
          </form>
        </div>
      ) : (
        <>
          {error && <p className="error-msg">{error}</p>}
          {loading ? (
            <Spinner />
          ) : (
            <>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Username</th>
                      <th>Email</th>
                      <th>Status</th>
                      <th>Roles</th>
                      <th>2FA</th>
                      <th>Active</th>
                      <th style={{ textAlign: "right" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="text-muted" style={{ padding: "1.5rem" }}>
                          {search ? "No users match your search." : "No users found."}
                        </td>
                      </tr>
                    ) : (
                      filtered.map((u) => (
                        <tr key={u.id}>
                          <td>{u.username}</td>
                          <td>{u.email}</td>
                          <td>
                            {u.needs_initial_password ? (
                              <span className="badge badge-warning" title="User accepted invitation but has not set a password yet">Setup incomplete</span>
                            ) : (
                              <span className="badge badge-success">Ready</span>
                            )}
                          </td>
                          <td>{u.roles.map((r) => r.name).join(", ") || "—"}</td>
                          <td>{u.totp_enabled ? <span className="badge badge-success">Yes</span> : "No"}</td>
                          <td>{u.is_active ? <span className="badge badge-success">Yes</span> : <span className="badge badge-danger">No</span>}</td>
                          <td style={{ textAlign: "right" }}>
                            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", flexWrap: "wrap" }}>
                              {u.needs_initial_password && (
                                <button
                                  type="button"
                                  className="btn-sm"
                                  disabled={resendWelcomeUserId === u.id}
                                  onClick={() => resendWelcome(u)}
                                  title="Send password reset link so they can complete setup"
                                >
                                  {resendWelcomeUserId === u.id ? "Sending…" : "Resend welcome"}
                                </button>
                              )}
                              <button type="button" className="btn-sm" onClick={() => startEditUser(u)}>Edit</button>
                              <button
                                type="button"
                                className="btn-sm btn-outline-danger"
                                disabled={deletingUserId === u.id || currentUser?.id === u.id}
                                onClick={() => requestDeleteUser(u)}
                                title={currentUser?.id === u.id ? "You cannot delete yourself" : undefined}
                              >
                                {deletingUserId === u.id ? "Deleting…" : "Delete"}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              <p className="table-meta">
                {total === 0 ? "No users found" : `Showing ${skip + 1}–${Math.min(skip + limit, total)} of ${total} — Page ${currentPage} of ${totalPages}`}
              </p>
              <div className="table-pagination">
                <button type="button" className="btn-outline" disabled={skip === 0} onClick={() => setSkip((s) => Math.max(0, s - limit))}>Previous</button>
                <button type="button" className="btn-outline" disabled={skip + limit >= total} onClick={() => setSkip((s) => s + limit)}>Next</button>
              </div>
            </>
          )}
        </>
      )}

      {/* Pending Invitations */}
      {!editingUserId && invitations.filter((i) => !i.accepted).length > 0 && (
        <div style={{ marginTop: "2rem" }}>
          <h2 style={{ fontSize: "1.1rem", color: "var(--text-primary)", marginBottom: "0.75rem" }}>Pending Invitations</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Invited By</th>
                  <th>Expires</th>
                  <th style={{ textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {invitations.filter((i) => !i.accepted).map((inv) => (
                  <tr key={inv.id}>
                    <td>{inv.email}</td>
                    <td>{inv.role_name}</td>
                    <td>{inv.invited_by_name || "—"}</td>
                    <td>{new Date(inv.expires_at).toLocaleDateString()}</td>
                    <td style={{ textAlign: "right" }}>
                      <button className="btn-sm btn-outline-danger" onClick={() => cancelInvitation(inv.id)}>Cancel</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <DestructiveVerificationModal
        open={confirmOpen}
        title="Delete User"
        message={confirmTarget ? `Delete user "${confirmTarget.username}" (${confirmTarget.email})? This cannot be undone.` : ""}
        action="delete_user"
        targetId={confirmTarget?.id ?? ""}
        targetName={confirmTarget ? `${confirmTarget.username} (${confirmTarget.email})` : ""}
        onVerified={doDeleteUser}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
