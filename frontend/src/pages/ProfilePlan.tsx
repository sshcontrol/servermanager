import { useState, useEffect } from "react";
import { useSearchParams, Link } from "react-router-dom";
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
  const [searchParams, setSearchParams] = useSearchParams();
  const [limits, setLimits] = useState<PlanLimits | null>(null);
  const [plans, setPlans] = useState<AvailablePlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [stripeEnabled, setStripeEnabled] = useState(false);
  const [checkoutPlanId, setCheckoutPlanId] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState("");
  const [autoRenewByPlan, setAutoRenewByPlan] = useState<Record<string, boolean>>({});

  useEffect(() => {
    Promise.all([
      api.get<PlanLimits>("/api/auth/plan-limits"),
      fetch(`${API_BASE}/api/public/plans`).then((r) => r.json()),
      fetch(`${API_BASE}/api/public/platform-settings`).then((r) => r.ok ? r.json() : {}).catch(() => ({})),
    ])
      .then(([lim, pls, settings]) => {
        setLimits(lim);
        setPlans(pls);
        setStripeEnabled(!!(settings as { stripe_enabled?: boolean })?.stripe_enabled);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Redirect to payment-result if user lands here with payment params (legacy or wrong URL)
  useEffect(() => {
    const success = searchParams.get("payment_success");
    const sessionId = searchParams.get("session_id");
    const canceled = searchParams.get("canceled");
    if (success === "true" && sessionId) {
      window.location.replace(`/#/payment-result?payment_success=true&session_id=${sessionId}`);
      return;
    }
    if (canceled === "true") {
      window.location.replace("/#/payment-result?canceled=true");
      return;
    }
  }, [searchParams, setSearchParams]);

  const handleUpgrade = async (planId: string, autoRenew: boolean) => {
    setCheckoutError("");
    setCheckoutPlanId(planId);
    try {
      const origin = window.location.origin;
      const res = await api.post<{ url: string }>("/api/admin/billing/checkout", {
        plan_id: planId,
        auto_renew: autoRenew,
        success_url: `${origin}/#/payment-result?payment_success=true&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/#/payment-result?canceled=true`,
      });
      if (res.url) window.location.href = res.url;
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : "Checkout failed");
    } finally {
      setCheckoutPlanId(null);
    }
  };

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

      {checkoutError && (
        <p className="error-msg" style={{ marginBottom: "1rem" }}>{checkoutError}</p>
      )}

      {/* Available Plans */}
      {isAdmin && plans.length > 0 && (
        <>
          <h2 style={{ color: "var(--text-primary)", marginBottom: "1.25rem", fontSize: "1.25rem" }}>Available Plans</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "1.5rem" }}>
            {plans.map((p) => {
              const isCurrent = p.id === limits?.plan_id;
              return (
                <div
                  key={p.id}
                  className="card"
                  style={{
                    position: "relative",
                    border: isCurrent ? "2px solid var(--accent)" : "1px solid rgba(255,255,255,0.08)",
                    borderRadius: 12,
                    padding: "1.5rem",
                    background: isCurrent ? "rgba(45, 212, 191, 0.06)" : "rgba(255,255,255,0.02)",
                    transition: "border-color 0.2s, background 0.2s",
                  }}
                >
                  {isCurrent && (
                    <div style={{ position: "absolute", top: 16, right: 16 }}>
                      <span className="badge badge-success">Current</span>
                    </div>
                  )}
                  <h3 style={{ margin: "0 0 0.5rem", color: "var(--text-primary)", fontSize: "1.25rem", fontWeight: 600 }}>
                    {p.name}
                  </h3>
                  {p.description && (
                    <p style={{ color: "var(--text-muted)", fontSize: "0.875rem", margin: "0 0 1rem", lineHeight: 1.4 }}>
                      {p.description}
                    </p>
                  )}
                  <div style={{ fontSize: "2rem", fontWeight: 700, color: "var(--accent)", marginBottom: "0.25rem" }}>
                    {p.is_free ? "Free" : `$${p.price}`}
                  </div>
                  <div style={{ color: "var(--text-muted)", fontSize: "0.8rem", marginBottom: "1.25rem" }}>
                    {p.duration_label}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginBottom: "1.25rem" }}>
                    <div style={{ padding: "0.75rem", background: "rgba(255,255,255,0.04)", borderRadius: 8, textAlign: "center" }}>
                      <div style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--text-primary)" }}>{p.max_users}</div>
                      <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>Users</div>
                    </div>
                    <div style={{ padding: "0.75rem", background: "rgba(255,255,255,0.04)", borderRadius: 8, textAlign: "center" }}>
                      <div style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--text-primary)" }}>{p.max_servers}</div>
                      <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>Servers</div>
                    </div>
                  </div>
                  {!isCurrent && !p.is_free && stripeEnabled && (
                    <div style={{ marginTop: "0.5rem", textAlign: "left" }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: "0.75rem",
                          marginBottom: "1rem",
                          padding: "0.5rem 0",
                        }}
                      >
                        <span style={{ fontSize: "0.875rem", color: "var(--text-secondary)" }}>
                          Auto-renew at end of period
                        </span>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={autoRenewByPlan[p.id] ?? false}
                          onClick={() => setAutoRenewByPlan((prev) => ({ ...prev, [p.id]: !(prev[p.id] ?? false) }))}
                          style={{
                            position: "relative",
                            width: 44,
                            height: 24,
                            borderRadius: 12,
                            border: "none",
                            cursor: "pointer",
                            background: (autoRenewByPlan[p.id] ?? false) ? "var(--accent)" : "rgba(255,255,255,0.2)",
                            transition: "background 0.2s",
                            flexShrink: 0,
                          }}
                        >
                          <span
                            style={{
                              position: "absolute",
                              top: 2,
                              left: (autoRenewByPlan[p.id] ?? false) ? 22 : 2,
                              width: 20,
                              height: 20,
                              borderRadius: "50%",
                              background: "#fff",
                              boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
                              transition: "left 0.2s",
                            }}
                          />
                        </button>
                      </div>
                      <button
                        className="primary"
                        style={{ width: "100%", padding: "0.75rem 1rem" }}
                        onClick={() => handleUpgrade(p.id, autoRenewByPlan[p.id] ?? false)}
                        disabled={!!checkoutPlanId}
                      >
                        {checkoutPlanId === p.id ? "Redirecting..." : "Upgrade"}
                      </button>
                    </div>
                  )}
                  {!isCurrent && !p.is_free && !stripeEnabled && (
                    <div style={{ color: "var(--text-muted)", fontSize: "0.8rem", textAlign: "center", padding: "0.5rem 0" }}>
                      Contact support to upgrade
                    </div>
                  )}
                  {!isCurrent && p.is_free && (
                    <div style={{ color: "var(--text-muted)", fontSize: "0.8rem", textAlign: "center", padding: "0.5rem 0" }}>
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
  return (
    <div className="container app-page">
      <div className="page-header">
        <Link to="/" className="btn-link">← Dashboard</Link>
        <h1 style={{ marginTop: "0.5rem" }}>Plan & billing</h1>
      </div>
      {content}
    </div>
  );
}
