import { useState, useEffect } from "react";
import { api } from "../api/client";
import Toggle from "../components/Toggle";

type PlanItem = {
  id: string;
  name: string;
  description?: string;
  price: number;
  currency: string;
  duration_days: number;
  duration_label: string;
  max_users: number;
  max_servers: number;
  is_free: boolean;
  is_hidden: boolean;
  is_active?: boolean;
  sort_order: number;
  stripe_price_id?: string | null;
};

const emptyPlan = {
  name: "", description: "", price: 0, currency: "USD",
  duration_days: 30, duration_label: "1 month",
  max_users: 3, max_servers: 5, is_free: false, is_hidden: false, sort_order: 0,
  stripe_price_id: "",
};

export default function SuperadminPlans() {
  const [plans, setPlans] = useState<PlanItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyPlan);
  const [saving, setSaving] = useState(false);

  const fetchPlans = async () => {
    setLoading(true);
    try {
      const res = await api.get<PlanItem[]>("/api/superadmin/plans");
      setPlans(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchPlans(); }, []);

  const openCreate = () => {
    setEditId(null);
    setForm(emptyPlan);
    setShowForm(true);
  };

  const openEdit = (p: PlanItem) => {
    setEditId(p.id);
    setForm({
      name: p.name, description: p.description || "", price: p.price, currency: p.currency,
      duration_days: p.duration_days, duration_label: p.duration_label,
      max_users: p.max_users, max_servers: p.max_servers, is_free: p.is_free, is_hidden: p.is_hidden, sort_order: p.sort_order,
      stripe_price_id: p.stripe_price_id || "",
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (editId) {
        await api.patch(`/api/superadmin/plans/${editId}`, form);
      } else {
        await api.post("/api/superadmin/plans", form);
      }
      setShowForm(false);
      await fetchPlans();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this plan?")) return;
    try {
      await api.delete(`/api/superadmin/plans/${id}`);
      await fetchPlans();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Delete failed");
    }
  };

  const update = (field: string, value: unknown) => setForm({ ...form, [field]: value });

  return (
    <div>
      <div className="page-header">
        <h1>Plans Management</h1>
        <button className="primary" onClick={openCreate}>+ New Plan</button>
      </div>

      {error && <p className="error-msg">{error}</p>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "1.25rem" }}>
        {loading ? (
          <p style={{ color: "var(--text-muted)" }}>Loading...</p>
        ) : plans.map((p) => (
          <div key={p.id} className="card" style={{ position: "relative" }}>
            <div style={{ position: "absolute", top: 12, right: 12, display: "flex", gap: 6 }}>
              {p.is_hidden && <span className="badge" style={{ background: "rgba(251,191,36,0.15)", color: "#fbbf24", border: "1px solid rgba(251,191,36,0.3)" }}>Hidden</span>}
              {p.is_free && <span className="badge badge-success">Free</span>}
            </div>
            <h3 style={{ margin: "0 0 0.25rem", color: "var(--text-primary)" }}>{p.name}</h3>
            {p.description && <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", margin: "0 0 0.75rem" }}>{p.description}</p>}
            <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "var(--accent)" }}>
              {p.is_free ? "Free" : `$${p.price}`}
            </div>
            <div style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginBottom: "1rem" }}>{p.duration_label}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", marginBottom: "1rem" }}>
              <div className="stat-box">
                <div className="stat-value">{p.max_users}</div>
                <div className="stat-label">Users</div>
              </div>
              <div className="stat-box">
                <div className="stat-value">{p.max_servers}</div>
                <div className="stat-label">Servers</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button className="btn-sm" onClick={() => openEdit(p)}>Edit</button>
              {!p.is_free && <button className="btn-sm btn-danger" onClick={() => handleDelete(p.id)}>Delete</button>}
            </div>
          </div>
        ))}
      </div>

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h2>{editId ? "Edit Plan" : "Create Plan"}</h2>
            <div className="form-group">
              <label>Name</label>
              <input value={form.name} onChange={(e) => update("name", e.target.value)} placeholder="Plan name" />
            </div>
            <div className="form-group">
              <label>Description</label>
              <textarea value={form.description} onChange={(e) => update("description", e.target.value)} placeholder="Optional description" rows={2} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
              <div className="form-group">
                <label>Price</label>
                <input type="number" step="0.01" min="0" value={form.price} onChange={(e) => update("price", parseFloat(e.target.value) || 0)} />
              </div>
              <div className="form-group">
                <label>Currency</label>
                <input value={form.currency} onChange={(e) => update("currency", e.target.value)} maxLength={3} />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
              <div className="form-group">
                <label>Duration (days)</label>
                <input type="number" min="1" value={form.duration_days} onChange={(e) => update("duration_days", parseInt(e.target.value) || 30)} />
              </div>
              <div className="form-group">
                <label>Duration Label</label>
                <input value={form.duration_label} onChange={(e) => update("duration_label", e.target.value)} placeholder="e.g. 1 month" />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
              <div className="form-group">
                <label>Max Users</label>
                <input type="number" min="1" value={form.max_users} onChange={(e) => update("max_users", parseInt(e.target.value) || 1)} />
              </div>
              <div className="form-group">
                <label>Max Servers</label>
                <input type="number" min="1" value={form.max_servers} onChange={(e) => update("max_servers", parseInt(e.target.value) || 1)} />
              </div>
            </div>
            <div className="form-group">
              <label>Stripe Price ID (for paid plans)</label>
              <input
                value={form.stripe_price_id || ""}
                onChange={(e) => update("stripe_price_id", e.target.value)}
                placeholder="price_xxx from Stripe Dashboard"
              />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
              <div className="form-group">
                <label>Sort Order</label>
                <input type="number" value={form.sort_order} onChange={(e) => update("sort_order", parseInt(e.target.value) || 0)} />
              </div>
              <div className="form-group" style={{ display: "flex", flexDirection: "column", gap: "0.75rem", paddingTop: "1.75rem" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "0.75rem", margin: 0, cursor: "pointer" }}>
                  <Toggle checked={form.is_free} onChange={(v) => update("is_free", v)} />
                  <span>Free plan</span>
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: "0.75rem", margin: 0, fontSize: "0.85rem", cursor: "pointer" }}>
                  <Toggle checked={form.is_hidden} onChange={(v) => update("is_hidden", v)} />
                  <span>Hidden (custom plan, not shown publicly)</span>
                </label>
              </div>
            </div>
            <div style={{ display: "flex", gap: "1rem", marginTop: "1.5rem" }}>
              <button className="primary" onClick={handleSave} disabled={saving}>
                {saving ? "Saving..." : editId ? "Update Plan" : "Create Plan"}
              </button>
              <button className="secondary" onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
