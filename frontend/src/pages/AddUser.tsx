import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useToast } from "../components/Toast";
import { COUNTRY_CODES, toE164, isValidE164 } from "../lib/phone";

type RoleOption = { id: string; name: string; description: string | null };
type ServerItem = { id: string; hostname: string; friendly_name: string | null; ip_address: string | null; description: string | null; status: string };
type PlanLimits = { max_users: number; current_users: number; pending_invitations?: number };

type AddMode = "invite" | "manual";

export default function AddUser() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [mode, setMode] = useState<AddMode>("invite");
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
    phoneCountryCode: "+1",
    phoneNumber: "",
    role_ids: [] as string[],
    server_access: {} as Record<string, "admin" | "user">,
  });

  useEffect(() => {
    api.get<RoleOption[]>("/api/roles").then(setRoles).catch(() => setRoles([]));
    api.get<ServerItem[]>("/api/servers").then((data) => setServers(Array.isArray(data) ? data : [])).catch(() => setServers([]));
    api.get<PlanLimits & { pending_invitations?: number }>("/api/auth/plan-limits").then(setLimits).catch(() => setLimits(null));
  }, []);

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
      await api.post("/api/users/invite", { email: inviteEmail.trim(), role_name: inviteRole });
      toast("success", `Invitation sent to ${inviteEmail}`);
      setInviteEmail("");
      setInviteRole("user");
      setTimeout(() => navigate("/users"), 1200);
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
    const phone = form.phoneNumber.trim() ? toE164(form.phoneCountryCode, form.phoneNumber) : null;
    if (phone && !isValidE164(phone)) {
      setMessage({ type: "error", text: "Please enter a valid phone number with country code (e.g. +1 234 567 8900)." });
      return;
    }
    if (form.password.length < 8) {
      setMessage({ type: "error", text: "Password must be at least 8 characters." });
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
      if (phone) payload.phone = phone;
      const res = await api.post<{ sync_results?: { server_name: string; success: boolean; error?: string }[] }>("/api/users", payload);
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
      setForm({ email: "", username: "", password: "", phoneCountryCode: "+1", phoneNumber: "", role_ids: [], server_access: {} });
      setTimeout(() => navigate("/users"), 1500);
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : "Failed to create user" });
    } finally {
      setLoading(false);
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

      <div className="add-user-mode-tabs" style={{ display: "flex", gap: "0.5rem", marginBottom: "1.5rem", borderBottom: "1px solid var(--border)", paddingBottom: "0.75rem" }}>
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
          className={mode === "manual" ? "primary" : "btn-outline"}
          onClick={() => setMode("manual")}
          style={{ padding: "0.5rem 1rem" }}
        >
          Add Manually
        </button>
      </div>

      {mode === "invite" && (
        <div className="card" style={{ maxWidth: 440 }}>
          <h2 className="card-subtitle" style={{ marginBottom: "1rem" }}>Send invitation</h2>
          <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginBottom: "1.25rem" }}>
            Send an email invitation for a new user to join your organization. They will set their password and complete onboarding.
          </p>
          {limits && limits.max_users > 0 && (limits.current_users + (limits.pending_invitations ?? 0)) >= limits.max_users && (
            <p style={{ color: "var(--text-muted)", padding: "1rem", background: "rgba(239,68,68,0.1)", borderRadius: 8, marginBottom: "1rem" }}>
              User limit reached. Upgrade your plan in <Link to="/profile/plan" style={{ color: "var(--accent)" }}>Profile → Plan</Link> to invite more users.
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
              <button type="button" onClick={() => navigate("/users")}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {mode === "manual" && (
      <div className="card">
        {limits && limits.current_users >= limits.max_users ? (
          <p style={{ color: "var(--text-muted)", padding: "1rem", background: "rgba(239,68,68,0.1)", borderRadius: 8 }}>
            User limit reached. Upgrade your plan in <Link to="/profile/plan" style={{ color: "var(--accent)" }}>Profile → Plan</Link> to add more users.
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
            <label htmlFor="phone">Phone (with country code) <span style={{ color: "var(--text-muted)", fontWeight: "normal" }}>— optional</span></label>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
              <select
                id="phone"
                value={form.phoneCountryCode}
                onChange={(e) => setForm((f) => ({ ...f, phoneCountryCode: e.target.value }))}
                style={{ minWidth: "120px" }}
              >
                {COUNTRY_CODES.map((c) => (
                  <option key={c.code} value={c.code}>{c.label}</option>
                ))}
              </select>
              <input
                type="tel"
                value={form.phoneNumber}
                onChange={(e) => setForm((f) => ({ ...f, phoneNumber: e.target.value.replace(/\D/g, "").slice(0, 15) }))}
                placeholder="2345678900"
                style={{ flex: "1", minWidth: "140px" }}
              />
            </div>
            <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
              For SMS verification. Enter number without leading zero.
            </p>
          </div>
          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              required
              minLength={8}
              placeholder="Min 8 characters"
            />
          </div>
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
