import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useToast } from "../components/Toast";
import { normalizeToE164, isValidE164 } from "../lib/phone";
import { validatePassword } from "../utils/password";
import PasswordField from "../components/PasswordField";

type RoleOption = { id: string; name: string; description: string | null };
type ServerItem = { id: string; hostname: string; friendly_name: string | null; ip_address: string | null; description: string | null; status: string };
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
  const { toast } = useToast();
  const [mode, setMode] = useState<AddMode>("invite");
  const [invitations, setInvitations] = useState<InvitationItem[]>([]);
  const [invitationsLoading, setInvitationsLoading] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [servers, setServers] = useState<ServerItem[]>([]);
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
    phone: "",
    role_ids: [] as string[],
    server_access: {} as Record<string, "admin" | "user">,
  });
  const [pendingPhoneUserId, setPendingPhoneUserId] = useState<string | null>(null);
  const [pendingPhone, setPendingPhone] = useState("");
  const [phoneVerifyCode, setPhoneVerifyCode] = useState("");
  const [phoneVerifyLoading, setPhoneVerifyLoading] = useState(false);

  useEffect(() => {
    api.get<RoleOption[]>("/api/roles").then(setRoles).catch(() => setRoles([]));
    api.get<ServerItem[]>("/api/servers").then((data) => setServers(Array.isArray(data) ? data : [])).catch(() => setServers([]));
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
      toast("success", "Invitation cancelled.");
      loadInvitations();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Failed to cancel invitation");
    } finally {
      setCancellingId(null);
    }
  };

  const toggleRole = (roleId: string) => {
    setForm((prev) => ({
      ...prev,
      role_ids: prev.role_ids.includes(roleId)
        ? prev.role_ids.filter((id) => id !== roleId)
        : [...prev.role_ids, roleId],
    }));
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setInviteLoading(true);
    setMessage(null);
    try {
      const res = await api.post<{ message?: string }>("/api/users/invite", { email: inviteEmail.trim(), role_name: inviteRole });
      toast("success", res?.message || `Invitation sent to ${inviteEmail}`);
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
    if (!form.email.trim() || !form.username.trim() || !form.password) {
      setMessage({ type: "error", text: "Email, username and password are required." });
      return;
    }
    const phone = form.phone.trim() ? normalizeToE164(form.phone) : null;
    if (phone && !isValidE164(phone)) {
      setMessage({ type: "error", text: "Please enter a valid phone number with country code (e.g. +1 234 567 8900)." });
      return;
    }
    const pwdErr = validatePassword(form.password);
    if (pwdErr) {
      setMessage({ type: "error", text: pwdErr });
      return;
    }
    setLoading(true);
    try {
      const server_access = Object.entries(form.server_access)
        .filter(([, role]) => role === "admin" || role === "user")
        .map(([server_id, role]) => ({ server_id, role }));
      const payload: Record<string, unknown> = {
        email: form.email.trim(),
        username: form.username.trim(),
        password: form.password,
        role_ids: form.role_ids,
        server_access,
      };
      const res = await api.post<{ id: string; sync_results?: { server_name: string; success: boolean; error?: string }[] }>("/api/users", payload);
      if (phone) {
        setPendingPhoneUserId(res.id);
        setPendingPhone(phone);
        setPhoneVerifyCode("");
        await api.post(`/api/users/${res.id}/request-phone-verification`, { phone });
        setMessage({ type: "success", text: "User created. Verification code sent to phone. Enter the code to complete." });
      } else {
        const sync = res?.sync_results || [];
        const ok = sync.filter((r) => r.success).length;
        const fail = sync.filter((r) => !r.success);
        const msg =
          fail.length === 0
            ? `User created. ${ok > 0 ? `Synced to ${ok} server(s).` : ""}`
            : fail.length === sync.length && sync.length > 0
              ? `User created but sync failed: ${fail.map((r) => r.error).join("; ")}`
              : `User created. ${ok} synced, ${fail.length} failed.`;
        setMessage({ type: "success", text: msg });
        setForm({ email: "", username: "", password: "", phone: "", role_ids: [], server_access: {} });
        setTimeout(() => navigate("/users"), 1500);
      }
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : "Failed to create user" });
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyPhone = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingPhoneUserId || !pendingPhone || phoneVerifyCode.length < 4) return;
    setMessage(null);
    setPhoneVerifyLoading(true);
    try {
      await api.post(`/api/users/${pendingPhoneUserId}/verify-phone`, { phone: pendingPhone, code: phoneVerifyCode });
      toast("success", "User created and phone verified.");
      setPendingPhoneUserId(null);
      setPendingPhone("");
      setPhoneVerifyCode("");
      setForm({ email: "", username: "", password: "", phone: "", role_ids: [], server_access: {} });
      setTimeout(() => navigate("/users"), 1200);
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : "Verification failed" });
    } finally {
      setPhoneVerifyLoading(false);
    }
  };

  return (
    <div className="container app-page">
      <div className="page-header">
        <h1>Add user</h1>
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
            <span style={{ marginLeft: 6, background: "var(--primary)", color: "var(--persian-teal)", borderRadius: 10, padding: "0.1rem 0.5rem", fontSize: "0.8rem" }}>
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
        <div className="card card-form" style={{ maxWidth: 440 }}>
          <h2 className="card-subtitle" style={{ marginBottom: "1rem" }}>Send invitation</h2>
          <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginBottom: "1.25rem" }}>
            Send an email invitation for a new user to join your organization. They will set their password and complete onboarding.
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
            </div>
            <div className="page-actions" style={{ marginTop: "1rem" }}>
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
              <button type="button" onClick={() => navigate("/users")}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {mode === "pending" && (
        <div className="card card-form" style={{ maxWidth: 640 }}>
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
      <div className="card card-form">
        {pendingPhoneUserId ? (
          <div>
            <h2 className="card-subtitle" style={{ marginBottom: "1rem" }}>Verify phone number</h2>
            <p style={{ color: "var(--text-muted)", marginBottom: "1rem" }}>
              A verification code was sent to {pendingPhone}. Ask the user for the code and enter it below.
            </p>
            <form onSubmit={handleVerifyPhone}>
              <div className="form-group">
                <label htmlFor="phone-verify-code">Verification code</label>
                <input
                  id="phone-verify-code"
                  type="text"
                  value={phoneVerifyCode}
                  onChange={(e) => setPhoneVerifyCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
                  placeholder="0000"
                  maxLength={8}
                  inputMode="numeric"
                />
              </div>
              <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
                <button type="submit" className="primary" disabled={phoneVerifyLoading || phoneVerifyCode.length < 4}>
                  {phoneVerifyLoading ? "Verifying…" : "Verify & complete"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPendingPhoneUserId(null);
                    setPendingPhone("");
                    setPhoneVerifyCode("");
                    toast("success", "User created.");
                    setTimeout(() => navigate("/users"), 1200);
                  }}
                >
                  Skip verification
                </button>
              </div>
            </form>
          </div>
        ) : limits && limits.current_users >= limits.max_users ? (
          <p style={{ color: "var(--text-muted)", padding: "1rem", background: "rgba(239,68,68,0.1)", borderRadius: 8 }}>
            User limit reached. Upgrade your plan in <Link to="/plan-billing/plan" style={{ color: "var(--accent)" }}>Plan & Billing</Link> to add more users.
          </p>
        ) : (
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              required
              placeholder="user@example.com"
            />
          </div>
          <div className="form-group">
            <label htmlFor="username">Username</label>
            <input
              id="username"
              type="text"
              value={form.username}
              onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
              required
              minLength={2}
              maxLength={100}
              placeholder="username"
            />
          </div>
          <div className="form-group">
            <label htmlFor="phone">Phone <span style={{ color: "var(--text-muted)", fontWeight: "normal" }}>— optional</span></label>
            <input
              id="phone"
              type="tel"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value.replace(/[^\d+]/g, "").slice(0, 16) }))}
              placeholder="+32xxx for country and phone format"
              style={{ width: "100%", maxWidth: 280 }}
            />
            <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
              Optional. A verification code will be sent to confirm before saving.
            </p>
          </div>
          <PasswordField
            id="password"
            value={form.password}
            onChange={(v) => setForm((f) => ({ ...f, password: v }))}
            label="Password"
            placeholder="Enter password"
          />
          <div className="form-group">
            <label>Roles</label>
            <div className="form-check-group">
              {roles.map((r) => (
                <label key={r.id} className="form-check-label">
                  <input
                    type="checkbox"
                    checked={form.role_ids.includes(r.id)}
                    onChange={() => toggleRole(r.id)}
                  />
                  <span>{r.name}</span>
                  {r.description && <span className="form-check-desc">({r.description})</span>}
                </label>
              ))}
            </div>
          </div>
          {servers.length > 0 && (
            <div className="form-group">
              <label>Server access</label>
              <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginBottom: "0.5rem" }}>
                Grant this user access to servers. Admin = can manage access on that server; User = view/use.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {servers.map((s) => (
                  <div key={s.id} style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
                    <span style={{ minWidth: "140px" }}>{s.friendly_name || s.hostname}</span>
                    <select
                      value={form.server_access[s.id] || ""}
                      onChange={(e) => {
                        const v = e.target.value as "" | "admin" | "user";
                        setForm((f) => ({
                          ...f,
                          server_access: v ? { ...f.server_access, [s.id]: v } : (() => { const { [s.id]: _, ...rest } = f.server_access; return rest; })(),
                        }));
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
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
            <button type="submit" className="primary" disabled={loading}>
              {loading ? "Creating…" : "Create user"}
            </button>
            <button type="button" onClick={() => navigate("/users")}>
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
