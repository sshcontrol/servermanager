import { useState, useEffect } from "react";
import { api } from "../api/client";

type TenantItem = {
  id: string;
  company_name: string;
  is_active: boolean;
  created_at: string;
  owner_email?: string;
  owner_full_name?: string;
  owner_username?: string;
  owner_phone?: string;
  owner_totp_enabled?: boolean;
  owner_email_verified?: boolean;
  owner_last_seen_at?: string;
  plan_name?: string;
  plan_id?: string;
  subscription_expires_at?: string;
  user_count: number;
  server_count: number;
};

type PlanOption = { id: string; name: string };

export default function SuperadminTenants() {
  const [tenants, setTenants] = useState<TenantItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [plans, setPlans] = useState<PlanOption[]>([]);

  // Edit modal
  const [editId, setEditId] = useState<string | null>(null);
  const [editCompany, setEditCompany] = useState("");
  const [editActive, setEditActive] = useState(true);
  const [editPlanId, setEditPlanId] = useState("");
  const [saving, setSaving] = useState(false);

  // Create modal
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({
    company_name: "",
    full_name: "",
    email: "",
    password: "",
    plan_id: "",
  });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  // Profile modal
  const [profileTenant, setProfileTenant] = useState<TenantItem | null>(null);

  // Delete confirm
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteName, setDeleteName] = useState("");
  const [deleting, setDeleting] = useState(false);

  const fetchTenants = async () => {
    setLoading(true);
    try {
      const res = await api.get<{ tenants: TenantItem[]; total: number }>(`/api/superadmin/tenants?page=${page}`);
      setTenants(res.tenants);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTenants();
    api.get<PlanOption[]>("/api/superadmin/plans").then(setPlans).catch(() => {});
  }, [page]);

  const startEdit = (t: TenantItem) => {
    setEditId(t.id);
    setEditCompany(t.company_name);
    setEditActive(t.is_active);
    setEditPlanId("");
  };

  const saveTenant = async () => {
    if (!editId) return;
    setSaving(true);
    try {
      await api.patch(`/api/superadmin/tenants/${editId}`, {
        company_name: editCompany,
        is_active: editActive,
      });
      if (editPlanId) {
        await api.post(`/api/superadmin/tenants/${editId}/assign-plan`, { plan_id: editPlanId });
      }
      setEditId(null);
      await fetchTenants();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleCreate = async () => {
    setCreateError("");
    if (!createForm.company_name || !createForm.full_name || !createForm.email || !createForm.password) {
      setCreateError("All fields are required");
      return;
    }
    setCreating(true);
    try {
      await api.post("/api/superadmin/tenants", {
        company_name: createForm.company_name,
        full_name: createForm.full_name,
        email: createForm.email,
        password: createForm.password,
        plan_id: createForm.plan_id || null,
      });
      setShowCreate(false);
      setCreateForm({ company_name: "", full_name: "", email: "", password: "", plan_id: "" });
      await fetchTenants();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create tenant");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      await api.delete(`/api/superadmin/tenants/${deleteId}`);
      setDeleteId(null);
      setDeleteName("");
      await fetchTenants();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  };

  const totalPages = Math.ceil(total / 50);

  const formatDate = (d?: string) => d ? new Date(d).toLocaleDateString() : "—";
  const formatDateTime = (d?: string) => d ? new Date(d).toLocaleString() : "Never";

  return (
    <div>
      <div className="page-header page-header-actions">
        <h1>Registered Tenants</h1>
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
          <span className="badge">{total} total</span>
          <button className="primary" onClick={() => setShowCreate(true)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6, verticalAlign: -2 }}>
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add Tenant
          </button>
        </div>
      </div>

      {error && <p className="error-msg">{error}</p>}

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Company</th>
              <th>Owner</th>
              <th>Email</th>
              <th>Plan</th>
              <th>Users</th>
              <th>Servers</th>
              <th>Registered</th>
              <th>Status</th>
              <th style={{ textAlign: "right" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} style={{ textAlign: "center", padding: "2rem" }}>Loading...</td></tr>
            ) : tenants.length === 0 ? (
              <tr><td colSpan={9} style={{ textAlign: "center", padding: "2rem", color: "var(--text-muted)" }}>No tenants found</td></tr>
            ) : tenants.map((t) => (
              <tr key={t.id}>
                <td style={{ fontWeight: 500 }}>{t.company_name}</td>
                <td>{t.owner_full_name || "—"}</td>
                <td>{t.owner_email || "—"}</td>
                <td><span className="badge">{t.plan_name || "None"}</span></td>
                <td>{t.user_count}</td>
                <td>{t.server_count}</td>
                <td>{formatDate(t.created_at)}</td>
                <td>
                  <span className={`badge ${t.is_active ? "badge-success" : "badge-danger"}`}>
                    {t.is_active ? "Active" : "Inactive"}
                  </span>
                </td>
                <td style={{ textAlign: "right" }}>
                  <div style={{ display: "flex", gap: "0.4rem", justifyContent: "flex-end" }}>
                    <button className="btn-sm" onClick={() => setProfileTenant(t)} title="View Profile">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                    </button>
                    <button className="btn-sm" onClick={() => startEdit(t)} title="Edit">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                    </button>
                    <button
                      className="btn-sm btn-outline-danger"
                      onClick={() => { setDeleteId(t.id); setDeleteName(t.company_name); }}
                      title="Delete"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "center", marginTop: "1rem" }}>
          <button className="btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</button>
          <span style={{ color: "var(--text-muted)", lineHeight: "32px" }}>Page {page} of {totalPages}</span>
          <button className="btn-sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      )}

      {/* ── Profile Modal ──────────────────────────────────────────────── */}
      {profileTenant && (
        <div className="modal-overlay" onClick={() => setProfileTenant(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 540 }}>
            <h2 style={{ marginBottom: "1.5rem" }}>Tenant Profile</h2>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem 2rem" }}>
              <ProfileField label="Company" value={profileTenant.company_name} />
              <ProfileField label="Status" value={
                <span className={`badge ${profileTenant.is_active ? "badge-success" : "badge-danger"}`}>
                  {profileTenant.is_active ? "Active" : "Inactive"}
                </span>
              } />
              <ProfileField label="Owner Name" value={profileTenant.owner_full_name || "—"} />
              <ProfileField label="Username" value={profileTenant.owner_username || "—"} />
              <ProfileField label="Email" value={profileTenant.owner_email || "—"} />
              <ProfileField label="Phone" value={profileTenant.owner_phone || "—"} />
              <ProfileField label="Email Verified" value={
                profileTenant.owner_email_verified
                  ? <span className="badge badge-success">Yes</span>
                  : <span className="badge badge-danger">No</span>
              } />
              <ProfileField label="2FA Enabled" value={
                profileTenant.owner_totp_enabled
                  ? <span className="badge badge-success">Yes</span>
                  : <span className="badge" style={{ background: "rgba(251,191,36,0.15)", color: "#fbbf24", border: "1px solid rgba(251,191,36,0.3)" }}>No</span>
              } />
              <ProfileField label="Plan" value={profileTenant.plan_name || "None"} />
              <ProfileField label="Plan Expires" value={formatDate(profileTenant.subscription_expires_at)} />
              <ProfileField label="Users" value={String(profileTenant.user_count)} />
              <ProfileField label="Servers" value={String(profileTenant.server_count)} />
              <ProfileField label="Registered" value={formatDate(profileTenant.created_at)} />
              <ProfileField label="Last Active" value={formatDateTime(profileTenant.owner_last_seen_at)} />
            </div>

            <div style={{ marginTop: "1.5rem", textAlign: "right" }}>
              <button className="secondary" onClick={() => setProfileTenant(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Modal ─────────────────────────────────────────────────── */}
      {editId && (
        <div className="modal-overlay" onClick={() => setEditId(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h2>Edit Tenant</h2>
            <div className="form-group">
              <label>Company Name</label>
              <input value={editCompany} onChange={(e) => setEditCompany(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Status</label>
              <select value={editActive ? "active" : "inactive"} onChange={(e) => setEditActive(e.target.value === "active")}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
            <div className="form-group">
              <label>Assign Plan</label>
              <select value={editPlanId} onChange={(e) => setEditPlanId(e.target.value)}>
                <option value="">— Keep current —</option>
                {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div style={{ display: "flex", gap: "1rem", marginTop: "1.5rem" }}>
              <button className="primary" onClick={saveTenant} disabled={saving}>
                {saving ? "Saving..." : "Save Changes"}
              </button>
              <button className="secondary" onClick={() => setEditId(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Create Modal ───────────────────────────────────────────────── */}
      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <h2>Add New Tenant</h2>
            <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginBottom: "1.25rem" }}>
              Create a new tenant with an admin account. The admin will be auto-verified and can log in immediately.
            </p>

            {createError && <p className="error-msg">{createError}</p>}

            <div className="form-group">
              <label>Company Name *</label>
              <input
                value={createForm.company_name}
                onChange={(e) => setCreateForm({ ...createForm, company_name: e.target.value })}
                placeholder="Acme Inc."
              />
            </div>
            <div className="form-group">
              <label>Admin Full Name *</label>
              <input
                value={createForm.full_name}
                onChange={(e) => setCreateForm({ ...createForm, full_name: e.target.value })}
                placeholder="John Doe"
              />
            </div>
            <div className="form-group">
              <label>Admin Email *</label>
              <input
                type="email"
                value={createForm.email}
                onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
                placeholder="admin@company.com"
              />
            </div>
            <div className="form-group">
              <label>Password *</label>
              <input
                type="password"
                value={createForm.password}
                onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
                placeholder="Min. 8 characters"
              />
            </div>
            <div className="form-group">
              <label>Assign Plan</label>
              <select value={createForm.plan_id} onChange={(e) => setCreateForm({ ...createForm, plan_id: e.target.value })}>
                <option value="">— Default (Free) —</option>
                {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div style={{ display: "flex", gap: "1rem", marginTop: "1.5rem" }}>
              <button className="primary" onClick={handleCreate} disabled={creating}>
                {creating ? "Creating..." : "Create Tenant"}
              </button>
              <button className="secondary" onClick={() => { setShowCreate(false); setCreateError(""); }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Confirm Modal ───────────────────────────────────────── */}
      {deleteId && (
        <div className="modal-overlay" onClick={() => setDeleteId(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
            <h2 style={{ color: "var(--danger, #ef4444)" }}>Delete Tenant</h2>
            <p style={{ color: "var(--text-primary)", lineHeight: 1.6 }}>
              Are you sure you want to delete <strong>{deleteName}</strong>?
            </p>
            <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", lineHeight: 1.6 }}>
              This will permanently remove the tenant and <strong>all</strong> associated data including:
            </p>
            <ul style={{ color: "var(--text-muted)", fontSize: "0.85rem", lineHeight: 1.8, paddingLeft: "1.5rem", margin: "0.5rem 0 1rem" }}>
              <li>All users and their SSH keys</li>
              <li>All registered servers</li>
              <li>Deployment tokens and platform SSH keys</li>
              <li>Subscriptions and invitations</li>
              <li>IP whitelist settings</li>
            </ul>
            <p style={{ color: "#ef4444", fontSize: "0.85rem", fontWeight: 600 }}>
              This action cannot be undone.
            </p>
            <div style={{ display: "flex", gap: "1rem", marginTop: "1.5rem" }}>
              <button
                className="primary"
                style={{ background: "var(--danger, #ef4444)" }}
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? "Deleting..." : "Delete Tenant"}
              </button>
              <button className="secondary" onClick={() => setDeleteId(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ProfileField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.2rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </div>
      <div style={{ fontSize: "0.9rem", color: "var(--text-primary)", fontWeight: 500 }}>
        {value}
      </div>
    </div>
  );
}
