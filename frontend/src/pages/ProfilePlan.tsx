import { useState, useEffect } from "react";
import { api } from "../api/client";
import { useAuth } from "../contexts/AuthContext";

const API_BASE = import.meta.env.VITE_API_URL || "";

type PlanLimits = {
  plan_name: string;
  plan_id?: string;
  max_users: number;
  max_servers: number;
  current_users: number;
  current_servers: number;
  starts_at?: string;
  expires_at?: string;
};

type AvailablePlan = {
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
};

type ProfilePlanProps = { embedded?: boolean };

export default function ProfilePlan({ embedded }: ProfilePlanProps) {
  const { user } = useAuth();
  const [limits, setLimits] = useState<PlanLimits | null>(null);
  const [plans, setPlans] = useState<AvailablePlan[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get<PlanLimits>("/api/auth/plan-limits"),
      fetch(`${API_BASE}/api/public/plans`).then((r) => r.json()),
    ])
      .then(([lim, pls]) => {
        setLimits(lim);
        setPlans(pls);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className={embedded ? "profile-section" : "container app-page"}>
        <div className="profile-section-card"><p style={{ color: "var(--text-muted)" }}>Loading...</p></div>
      </div>
    );
  }

  const usersPercent = limits ? Math.min(100, Math.round((limits.current_users / limits.max_users) * 100)) : 0;
  const serversPercent = limits ? Math.min(100, Math.round((limits.current_servers / limits.max_servers) * 100)) : 0;
  const isAdmin = user?.is_superuser || user?.roles?.some((r) => r.name === "admin");

  const content = (
    <>
      {!embedded && (
        <div className="page-header">
          <h1>Plan & Billing</h1>
        </div>
      )}
      {/* Current Plan Card */}
      <div className="card" style={{ marginBottom: "2rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem", marginBottom: "1.5rem" }}>
          <div>
            <h2 style={{ margin: 0, color: "var(--text-primary)" }}>Current Plan</h2>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginTop: "0.5rem" }}>
              <span style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--accent)" }}>{limits?.plan_name || "—"}</span>
              {limits?.plan_name && limits.plan_name !== "None" && limits.plan_name !== "N/A" && (
                <span className="badge badge-success">Active</span>
              )}
            </div>
          </div>
          {(limits?.starts_at || limits?.expires_at) && (
            <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
              {limits?.starts_at && (
                <div style={{ textAlign: "left" }}>
                  <div style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>Start date of service</div>
                  <div style={{ color: "var(--text-secondary)", fontWeight: 500 }}>
                    {new Date(limits.starts_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
                  </div>
                </div>
              )}
              {limits?.expires_at && (
                <div style={{ textAlign: "left" }}>
                  <div style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>End date of service</div>
                  <div style={{ color: "var(--text-secondary)", fontWeight: 500 }}>
                    {new Date(limits.expires_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem" }}>
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.4rem" }}>
              <span style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>Users</span>
              <span style={{ color: "var(--text-primary)", fontWeight: 600, fontSize: "0.85rem" }}>
                {limits?.current_users ?? 0} / {limits?.max_users ?? 0}
              </span>
            </div>
            <div style={{ background: "rgba(255,255,255,0.06)", borderRadius: 6, height: 8, overflow: "hidden" }}>
              <div style={{ background: usersPercent > 85 ? "#ef4444" : "var(--accent)", width: `${usersPercent}%`, height: "100%", borderRadius: 6, transition: "width 0.4s ease" }} />
            </div>
          </div>
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.4rem" }}>
              <span style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>Servers</span>
              <span style={{ color: "var(--text-primary)", fontWeight: 600, fontSize: "0.85rem" }}>
                {limits?.current_servers ?? 0} / {limits?.max_servers ?? 0}
              </span>
            </div>
            <div style={{ background: "rgba(255,255,255,0.06)", borderRadius: 6, height: 8, overflow: "hidden" }}>
              <div style={{ background: serversPercent > 85 ? "#ef4444" : "var(--accent)", width: `${serversPercent}%`, height: "100%", borderRadius: 6, transition: "width 0.4s ease" }} />
            </div>
          </div>
        </div>
      </div>

      {/* Available Plans */}
      {isAdmin && plans.length > 0 && (
        <>
          <h2 style={{ color: "var(--text-primary)", marginBottom: "1rem" }}>Available Plans</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "1.25rem" }}>
            {plans.map((p) => {
              const isCurrent = p.id === limits?.plan_id;
              return (
                <div
                  key={p.id}
                  className="card"
                  style={{
                    position: "relative",
                    border: isCurrent ? "2px solid var(--accent)" : undefined,
                    opacity: isCurrent ? 0.7 : 1,
                  }}
                >
                  {isCurrent && (
                    <div style={{ position: "absolute", top: 12, right: 12 }}>
                      <span className="badge badge-success">Current</span>
                    </div>
                  )}
                  <h3 style={{ margin: "0 0 0.25rem", color: "var(--text-primary)" }}>{p.name}</h3>
                  {p.description && (
                    <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", margin: "0 0 0.75rem" }}>
                      {p.description}
                    </p>
                  )}
                  <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "var(--accent)" }}>
                    {p.is_free ? "Free" : `$${p.price}`}
                  </div>
                  <div style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginBottom: "1rem" }}>
                    {p.duration_label}
                  </div>
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
                  {!isCurrent && !p.is_free && (
                    <div style={{ color: "var(--text-muted)", fontSize: "0.8rem", textAlign: "center" }}>
                      Contact support to upgrade
                    </div>
                  )}
                  {!isCurrent && p.is_free && (
                    <div style={{ color: "var(--text-muted)", fontSize: "0.8rem", textAlign: "center" }}>
                      Free tier
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </>
  );

  if (embedded) {
    return <div className="profile-section">{content}</div>;
  }
  return <div className="container app-page">{content}</div>;
}
