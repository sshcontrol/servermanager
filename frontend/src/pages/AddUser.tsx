import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useToast } from "../components/Toast";
import { validatePassword } from "../utils/password";
import PasswordField from "../components/PasswordField";

type RoleOption = { id: string; name: string; description: string | null };
type PlanLimits = { max_users: number; current_users: number; pending_invitations?: number };

type AddMode = "invite" | "manual" | "pending";

type InvitationItem = {
  id: string;
  email: string;
  role_name: string;
  accepted: boolean;
  expires_at: string;
  created_at: string;
  invited_by_name: string | null;
};

export default function AddUser() {
  const navigate = useNavigate();
  const { toast, showSuccessModal } = useToast();
  const [mode, setMode] = useState<AddMode>("invite");
  const [invitations, setInvitations] = useState<InvitationItem[]>([]);
  const [invitationsLoading, setInvitationsLoading] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [limits, setLimits] = useState<PlanLimits | null>(null);
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("user");
  const [inviteLoading, setInviteLoading] = useState(false);

  const [form, setForm] = useState({
    email: "",
    username: "",
    password: "",
    confirmPassword: "",
    manualRole: "user" as "user" | "admin",
  });

  useEffect(() => {
    api.get<RoleOption[]>("/api/roles").then(setRoles).catch(() => setRoles([]));
    api.get<PlanLimits & { pending_invitations?: number }>("/api/auth/plan-limits").then(setLimits).catch(() => setLimits(null));
  }, []);

  const loadInvitations = async () => {
    setInvitationsLoading(true);
    try {
      const res = await api.get<{ invitations: InvitationItem[] }>("/api/users/invitations");
      setInvitations(res.invitations || []);
    } catch {
      setInvitations([]);
    } finally {
      setInvitationsLoading(false);
    }
  };

  useEffect(() => {
    loadInvitations();
  }, []);

  useEffect(() => {
    if (mode === "pending") loadInvitations();
  }, [mode]);

  const cancelInvitation = async (id: string) => {
    setCancellingId(id);
    try {
      await api.delete(`/api/users/invitations/${id}`);
      showSuccessModal("Invitation cancelled.");
      loadInvitations();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Failed to cancel invitation");
    } finally {
      setCancellingId(null);
    }
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setInviteLoading(true);
    setMessage(null);
    try {
      const res = await api.post<{ message?: string }>("/api/users/invite", { email: inviteEmail.trim(), role_name: inviteRole });
      showSuccessModal(res?.message || `Invitation sent to ${inviteEmail}`);
      setInviteEmail("");
      setInviteRole("user");
      await loadInvitations();
      setMode("pending");
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : "Failed to send invitation" });
    } finally {
      setInviteLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    if (!form.email.trim() || !form.username.trim() || !form.password || !form.confirmPassword) {
      setMessage({ type: "error", text: "All fields are required." });
      return;
    }
    if (form.password !== form.confirmPassword) {
      setMessage({ type: "error", text: "Password and confirm password do not match." });
      return;
    }
    const pwdErr = validatePassword(form.password);
    if (pwdErr) {
      setMessage({ type: "error", text: pwdErr });
      return;
    }
    const roleIds = roles.filter((r) => r.name.toLowerCase() === form.manualRole).map((r) => r.id);
    if (roleIds.length === 0) {
      setMessage({ type: "error", text: "Invalid role. Please ensure user or admin role exists." });
      return;
    }
    setLoading(true);
    try {
      const payload = {
        email: form.email.trim(),
        username: form.username.trim(),
        password: form.password,
        role_ids: roleIds,
        server_access: [] as { server_id: string; role: string }[],
      };
      const res = await api.post<{ sync_results?: { server_name: string; success: boolean; error?: string }[] }>("/api/users", payload);
      const sync = res?.sync_results || [];
      const ok = sync.filter((r) => r.success).length;
      const fail = sync.filter((r) => !r.success);
      const msg =
        fail.length === 0
          ? "User created successfully. The user can log in immediately with the credentials provided."
          : fail.length === sync.length && sync.length > 0
            ? `User created but sync failed: ${fail.map((r) => r.error).join("; ")}`
            : `User created. ${ok} synced, ${fail.length} failed.`;
      showSuccessModal(msg);
      setForm({ email: "", username: "", password: "", confirmPassword: "", manualRole: "user" });
      setTimeout(() => navigate("/users"), 1200);
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : "Failed to create user" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container app-page">
      <div className="page-header">
        <Link to="/users" className="btn-link">← Modify users</Link>
        <h1 style={{ marginTop: "0.5rem" }}>Add user</h1>
      </div>
      {message && (
        <p className={message.type === "error" ? "error-msg" : "success-msg"} style={{ marginBottom: "1rem" }}>
          {message.text}
        </p>
      )}

      {limits && (
        <div style={{ marginBottom: "1rem", padding: "0.75rem 1rem", background: "rgba(45,212,191,0.08)", border: "1px solid rgba(45,212,191,0.2)", borderRadius: 10, fontSize: "0.9rem" }}>
          {limits.current_users} of {limits.max_users} users
          {(limits.pending_invitations ?? 0) > 0 && ` (${limits.pending_invitations} pending)`}
          {(limits.current_users >= limits.max_users) || ((limits.current_users + (limits.pending_invitations ?? 0)) >= limits.max_users) ? (
            <span style={{ color: "var(--danger)", marginLeft: "0.5rem" }}>— Limit reached. Upgrade your plan to add more.</span>
          ) : null}
        </div>
      )}

      <div className="add-user-mode-tabs" style={{ display: "flex", gap: "0.5rem", marginBottom: "1.5rem", borderBottom: "1px solid var(--border)", paddingBottom: "0.75rem", flexWrap: "wrap" }}>
        <button
          type="button"
          className={mode === "invite" ? "primary" : "btn-outline"}
          onClick={() => setMode("invite")}
          style={{ padding: "0.5rem 1rem" }}
        >
          Invite User
        </button>
        <button
          type="button"
          className={mode === "pending" ? "primary" : "btn-outline"}
          onClick={() => setMode("pending")}
          style={{ padding: "0.5rem 1rem" }}
        >
          Pending Invitations
          {invitations.filter((i) => !i.accepted).length > 0 && (
            <span style={{ marginLeft: 6, background: "var(--primary)", color: "var(--primary-on)", borderRadius: 10, padding: "0.1rem 0.5rem", fontSize: "0.8rem" }}>
              {invitations.filter((i) => !i.accepted).length}
            </span>
          )}
        </button>
        <button
          type="button"
          className={mode === "manual" ? "primary" : "btn-outline"}
          onClick={() => setMode("manual")}
          style={{ padding: "0.5rem 1rem" }}
        >
          Add Manually
        </button>
      </div>

      {mode === "invite" && (
        <div className="card card-form" style={{ maxWidth: "100%" }}>
          <h2 className="card-subtitle" style={{ marginBottom: "1rem" }}>Send Invitation</h2>
          <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginBottom: "1.25rem" }}>
            Send an email invitation for a new user to join your organization. The recipient will set their password and complete onboarding.
          </p>
          {limits && limits.max_users > 0 && (limits.current_users + (limits.pending_invitations ?? 0)) >= limits.max_users && (
            <p style={{ color: "var(--text-muted)", padding: "1rem", background: "rgba(239,68,68,0.1)", borderRadius: 8, marginBottom: "1rem" }}>
              User limit reached. Upgrade your plan in <Link to="/plan-billing/plan" style={{ color: "var(--accent)" }}>Plan & Billing</Link> to invite more users.
            </p>
          )}
          <form onSubmit={handleInvite}>
            <div className="form-group">
              <label htmlFor="invite-email">Email Address</label>
              <input
                id="invite-email"
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="user@example.com"
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="invite-role">Role</label>
              <select id="invite-role" value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
              <p className="form-hint" style={{ marginTop: "0.5rem" }}>
                Role applies to the SSHControl dashboard. Admin: full access to the admin dashboard. User: limited access to assigned servers only.
              </p>
            </div>
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
              <button
                type="submit"
                className="primary"
                disabled={
                  inviteLoading ||
                  !inviteEmail.trim() ||
                  (!!limits && limits.max_users > 0 && (limits.current_users + (limits.pending_invitations ?? 0)) >= limits.max_users)
                }
              >
                {inviteLoading ? "Sending…" : "Send Invitation"}
              </button>
              <button type="button" className="btn-outline" onClick={() => navigate("/users")}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {mode === "pending" && (
        <div className="card card-form" style={{ maxWidth: "100%" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem", marginBottom: "1rem" }}>
            <h2 className="card-subtitle" style={{ marginBottom: 0 }}>Pending invitations</h2>
            {invitations.filter((i) => !i.accepted).length > 0 && (
              <span className="badge" style={{ fontSize: "0.85rem" }}>
                {invitations.filter((i) => !i.accepted).length} pending
              </span>
            )}
          </div>
          <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginBottom: "1.25rem" }}>
            Invitations that have been sent but not yet accepted. You can cancel an invitation to free up the slot or resend to a different email.
          </p>
          {invitationsLoading ? (
            <p style={{ color: "var(--text-muted)", padding: "2rem", textAlign: "center" }}>Loading…</p>
          ) : invitations.filter((i) => !i.accepted).length === 0 ? (
            <p style={{ color: "var(--text-muted)", padding: "2rem", textAlign: "center", background: "rgba(255,255,255,0.03)", borderRadius: 8 }}>
              No pending invitations.
            </p>
          ) : (
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
                        <button
                          type="button"
                          className="btn-sm btn-outline-danger"
                          disabled={cancellingId === inv.id}
                          onClick={() => cancelInvitation(inv.id)}
                        >
                          {cancellingId === inv.id ? "Cancelling…" : "Cancel"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div style={{ marginTop: "1rem" }}>
            <button type="button" className="btn-outline" onClick={() => navigate("/users")}>
              Back to users
            </button>
          </div>
        </div>
      )}

      {mode === "manual" && (
        <div className="card card-form" style={{ maxWidth: "100%" }}>
          <h2 className="card-subtitle" style={{ marginBottom: "1rem" }}>Add User Manually</h2>
          <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginBottom: "1.25rem" }}>
            Users added manually do not need to verify their account. They can log in immediately with the credentials you provide. Server access can be assigned later from Modify users.
          </p>
          {limits && limits.current_users >= limits.max_users ? (
            <p style={{ color: "var(--text-muted)", padding: "1rem", background: "rgba(239,68,68,0.1)", borderRadius: 8 }}>
              User limit reached. Upgrade your plan in <Link to="/plan-billing/plan" style={{ color: "var(--accent)" }}>Plan & Billing</Link> to add more users.
            </p>
          ) : (
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label htmlFor="manual-email">Email</label>
                <input
                  id="manual-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  required
                  placeholder="user@example.com"
                />
              </div>
              <div className="form-group">
                <label htmlFor="manual-username">Username</label>
                <input
                  id="manual-username"
                  type="text"
                  value={form.username}
                  onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                  required
                  minLength={2}
                  maxLength={100}
                  placeholder="username"
                />
              </div>
              <PasswordField
                id="manual-password"
                value={form.password}
                onChange={(v) => setForm((f) => ({ ...f, password: v }))}
                label="Password"
                placeholder="Enter password"
              />
              <PasswordField
                id="manual-confirm-password"
                value={form.confirmPassword}
                onChange={(v) => setForm((f) => ({ ...f, confirmPassword: v }))}
                label="Confirm Password"
                placeholder="Re-enter password"
                showRequirements={false}
                showStrength={false}
              />
              <div className="form-group">
                <label htmlFor="manual-role">Role</label>
                <select id="manual-role" value={form.manualRole} onChange={(e) => setForm((f) => ({ ...f, manualRole: e.target.value as "user" | "admin" }))}>
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
                <p className="form-hint" style={{ marginTop: "0.5rem" }}>
                  This role applies to SSHControl panel administration, not server access. Admin: full access to the admin dashboard. User: limited access to assigned servers only.
                </p>
              </div>
              <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
                <button type="submit" className="primary" disabled={loading}>
                  {loading ? "Creating…" : "Create user"}
                </button>
                <button type="button" className="btn-outline" onClick={() => navigate("/users")}>
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
