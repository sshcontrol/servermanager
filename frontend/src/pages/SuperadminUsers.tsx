import { useState, useEffect } from "react";
import { api } from "../api/client";
import { useToast } from "../components/Toast";
import ConfirmModal from "../components/ConfirmModal";

type UserItem = {
  id: string;
  username: string;
  email: string;
  full_name?: string | null;
  tenant_id?: string | null;
  company_name?: string | null;
  email_verified: boolean;
  totp_enabled: boolean;
  sms_verification_enabled: boolean;
  is_active: boolean;
  is_superuser: boolean;
  created_at: string;
};

export default function SuperadminUsers() {
  const { toast } = useToast();
  const [users, setUsers] = useState<UserItem[]>([]);
  const [total, setTotal] = useState(0);
  const [skip, setSkip] = useState(0);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UserItem | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const limit = 50;

  const fetchUsers = async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ skip: String(skip), limit: String(limit) });
      if (search.trim()) params.set("search", search.trim());
      const res = await api.get<{ users: UserItem[]; total: number }>(`/api/superadmin/users?${params}`);
      setUsers(res.users);
      setTotal(res.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, [skip]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSkip(0);
    fetchUsers();
  };

  const toggleTotp = async (u: UserItem) => {
    setTogglingId(u.id);
    try {
      await api.patch(`/api/superadmin/users/${u.id}`, { totp_enabled: !u.totp_enabled });
      setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, totp_enabled: !x.totp_enabled } : x)));
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to update");
    } finally {
      setTogglingId(null);
    }
  };

  const toggleSms = async (u: UserItem) => {
    setTogglingId(u.id);
    try {
      await api.patch(`/api/superadmin/users/${u.id}`, { sms_verification_enabled: !u.sms_verification_enabled });
      setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, sms_verification_enabled: !x.sms_verification_enabled } : x)));
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to update");
    } finally {
      setTogglingId(null);
    }
  };

  const verifyEmail = async (u: UserItem) => {
    setVerifyingId(u.id);
    try {
      await api.patch(`/api/superadmin/users/${u.id}`, { email_verified: true });
      setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, email_verified: true } : x)));
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to verify");
    } finally {
      setVerifyingId(null);
    }
  };

  const doDeleteUser = async () => {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    setDeletingId(id);
    setDeleteTarget(null);
    try {
      await api.delete(`/api/superadmin/users/${id}`);
      toast("success", "User removed. They can register or be invited again.");
      fetchUsers();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Failed to remove user");
    } finally {
      setDeletingId(null);
    }
  };

  const totalPages = Math.ceil(total / limit) || 1;
  const currentPage = Math.floor(skip / limit) + 1;

  return (
    <div className="container app-page">
      <div className="page-header page-header-actions">
        <h1>All Users</h1>
        <span className="badge">{total} total</span>
      </div>

      <form onSubmit={handleSearch} style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem", flexWrap: "wrap" }}>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by username, email, or name..."
          style={{ flex: "1", minWidth: 200, maxWidth: 320 }}
        />
        <button type="submit" className="primary">Search</button>
      </form>

      {error && <p className="error-msg">{error}</p>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>User</th>
              <th>Email</th>
              <th>Tenant</th>
              <th>Email Verified</th>
              <th>2FA</th>
              <th>SMS Verification</th>
              <th>Status</th>
              <th>Registered</th>
              <th style={{ textAlign: "right" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} style={{ textAlign: "center", padding: "2rem" }}>Loading...</td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan={9} style={{ textAlign: "center", padding: "2rem", color: "var(--text-muted)" }}>No users found</td></tr>
            ) : (
              users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <strong>{u.full_name || u.username}</strong>
                    {u.is_superuser && <span className="badge" style={{ marginLeft: 4, fontSize: "0.7rem" }}>Admin</span>}
                  </td>
                  <td style={{ color: "var(--text-muted)" }}>{u.email}</td>
                  <td>{u.company_name || "—"}</td>
                  <td>
                    {u.email_verified ? (
                      <span className="badge badge-success">Yes</span>
                    ) : (
                      <button
                        type="button"
                        className="btn-sm secondary"
                        disabled={verifyingId === u.id}
                        onClick={() => verifyEmail(u)}
                        title="Verify email (user couldn't verify via email link)"
                      >
                        {verifyingId === u.id ? "…" : "Verify"}
                      </button>
                    )}
                  </td>
                  <td>
                    <button
                      type="button"
                      className={`btn-sm ${u.totp_enabled ? "badge badge-success" : "badge"}`}
                      onClick={() => toggleTotp(u)}
                      disabled={togglingId === u.id}
                      style={{ cursor: "pointer", border: "none" }}
                    >
                      {togglingId === u.id ? "…" : u.totp_enabled ? "On" : "Off"}
                    </button>
                  </td>
                  <td>
                    <button
                      type="button"
                      className={`btn-sm ${u.sms_verification_enabled ? "badge badge-success" : "badge"}`}
                      onClick={() => toggleSms(u)}
                      disabled={togglingId === u.id}
                      style={{ cursor: "pointer", border: "none" }}
                    >
                      {togglingId === u.id ? "…" : u.sms_verification_enabled ? "On" : "Off"}
                    </button>
                  </td>
                  <td>
                    <span className={`badge ${u.is_active ? "badge-success" : "badge-danger"}`}>
                      {u.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td>{new Date(u.created_at).toLocaleDateString()}</td>
                  <td style={{ textAlign: "right" }}>
                    <button
                      type="button"
                      className="btn-sm btn-outline-danger"
                      disabled={deletingId === u.id}
                      onClick={() => setDeleteTarget(u)}
                      title="Remove user so they can register or be invited again"
                    >
                      {deletingId === u.id ? "Removing…" : "Remove"}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "center", marginTop: "1rem" }}>
          <button className="btn-sm" disabled={skip === 0} onClick={() => setSkip((s) => Math.max(0, s - limit))}>Prev</button>
          <span style={{ color: "var(--text-muted)", lineHeight: "32px" }}>Page {currentPage} of {totalPages}</span>
          <button className="btn-sm" disabled={skip + limit >= total} onClick={() => setSkip((s) => s + limit)}>Next</button>
        </div>
      )}

      <ConfirmModal
        open={!!deleteTarget}
        title="Remove User"
        message={deleteTarget ? `Remove "${deleteTarget.full_name || deleteTarget.username}" (${deleteTarget.email})? They will be able to register or be invited again.` : ""}
        confirmLabel="Remove"
        danger
        onConfirm={doDeleteUser}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
