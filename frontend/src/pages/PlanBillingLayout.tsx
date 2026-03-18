import { NavLink, Outlet, Link } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

const tabIcon = (name: string) => {
  const Icon = ({ children }: { children: React.ReactNode }) => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
  switch (name) {
    case "plan": return <Icon><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v3"/></Icon>;
    case "billing": return <Icon><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></Icon>;
    case "payment": return <Icon><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/><path d="M7 15h.01"/></Icon>;
    default: return null;
  }
};

export default function PlanBillingLayout() {
  const { isAdmin, isPlatformSuperadmin } = useAuth();
  const base = "/plan-billing";

  if (!isAdmin || isPlatformSuperadmin) {
    return (
      <div className="container app-page">
        <p className="error-msg">Admin access required.</p>
      </div>
    );
  }

  const tabs = [
    { path: `${base}/plan`, label: "Plan" },
    { path: `${base}/billing`, label: "Billing" },
    { path: `${base}/payment`, label: "Payment" },
  ];

  return (
    <div className="container app-page profile-page">
      <div className="profile-page-header">
        <Link to="/" className="btn-link">← Dashboard</Link>
        <h1 style={{ marginTop: "0.5rem" }}>Plan & billing</h1>
        <p className="profile-page-subtitle">Manage your plan, billing address, and payment history</p>
      </div>

      <div className="profile-tabs">
        {tabs.map((t) => (
          <NavLink
            key={t.path}
            to={t.path}
            className={({ isActive }) => `profile-tab${isActive ? " active" : ""}`}
          >
            {tabIcon(t.path.split("/").pop() || "")}
            <span>{t.label}</span>
          </NavLink>
        ))}
      </div>

      <div className="profile-tab-content">
        <Outlet />
      </div>
    </div>
  );
}
