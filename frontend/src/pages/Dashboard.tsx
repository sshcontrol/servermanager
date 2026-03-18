import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../api/client";

type ServerStats = {
  assigned_count: number;
  total?: number;
  online?: number;
  offline?: number;
};

type UserStats = {
  total: number;
  active: number;
  inactive: number;
};

type PlanLimits = {
  plan_name: string;
  max_users: number;
  current_users: number;
  max_servers: number;
  current_servers: number;
  starts_at: string | null;
  expires_at: string | null;
};

export default function Dashboard() {
  const { user, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [serverStats, setServerStats] = useState<ServerStats | null>(null);
  const [userStats, setUserStats] = useState<UserStats | null>(null);
  const [planLimits, setPlanLimits] = useState<PlanLimits | null>(null);

  useEffect(() => {
    api
      .get<ServerStats>(`/api/servers/stats${isAdmin ? "?with_status=true" : ""}`)
      .then(setServerStats)
      .catch(() => setServerStats(null));
  }, [isAdmin]);

  useEffect(() => {
    if (isAdmin) {
      api.get<UserStats>("/api/users/stats").then(setUserStats).catch(() => setUserStats(null));
    }
  }, [isAdmin]);

  useEffect(() => {
    if (user?.tenant_id) {
      api.get<PlanLimits>("/api/auth/plan-limits").then(setPlanLimits).catch(() => setPlanLimits(null));
    }
  }, [user?.tenant_id]);

  const planDaysLeft =
    planLimits?.expires_at
      ? Math.ceil((new Date(planLimits.expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
      : null;
  const planExpired = planDaysLeft !== null && planDaysLeft < 0;
  const planUrgent = planDaysLeft !== null && planDaysLeft >= 0 && planDaysLeft <= 10;

  if (isAdmin) {
    return (
      <div className="container app-page dashboard-page">
        <div className="dashboard-panel">
        <header className="dashboard-header">
          <h1>Dashboard</h1>
          <p className="dashboard-welcome">Welcome back, <strong>{user?.username}</strong></p>
        </header>

        {planLimits && planLimits.plan_name && planLimits.plan_name !== "N/A" && planLimits.plan_name !== "None" && (
          <div className={`dashboard-plan-card ${planExpired ? "dashboard-plan-expired" : planUrgent ? "dashboard-plan-urgent" : ""}`}>
            <span className="dashboard-plan-label">Your plan:</span>
            <div className="dashboard-plan-info">
              <span className="dashboard-plan-name">{planLimits.plan_name}</span>
              <span className="dashboard-plan-days">
                {planDaysLeft === null ? "" : planDaysLeft >= 0 ? `${planDaysLeft} days left` : `${Math.abs(planDaysLeft)} days overdue`}
              </span>
              {planExpired && (
                <Link to="/plan-billing/plan" className="dashboard-plan-renew">Renew plan</Link>
              )}
            </div>
          </div>
        )}

        <div className="dashboard-admin-cards">
          <Link to="/server/access" className="dashboard-admin-card dashboard-admin-card-servers">
            <div className="dashboard-admin-card-icon" aria-hidden>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
                <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
                <line x1="6" y1="6" x2="6.01" y2="6" />
                <line x1="6" y1="18" x2="6.01" y2="18" />
                <line x1="18" y1="6" x2="18.01" y2="6" />
                <line x1="18" y1="18" x2="18.01" y2="18" />
              </svg>
            </div>
            <h2 className="dashboard-admin-card-title">Servers</h2>
            <p className="dashboard-admin-card-desc">View and manage all servers</p>
            <div className="dashboard-admin-stats">
              <div className="dashboard-admin-stat dashboard-admin-stat-online">
                <span className="dashboard-admin-stat-dot" />
                <span className="dashboard-admin-stat-value">{serverStats?.online ?? "—"}</span>
                <span className="dashboard-admin-stat-label">Online</span>
              </div>
              <div className="dashboard-admin-stat dashboard-admin-stat-offline">
                <span className="dashboard-admin-stat-dot" />
                <span className="dashboard-admin-stat-value">{serverStats?.offline ?? "—"}</span>
                <span className="dashboard-admin-stat-label">Offline</span>
              </div>
            </div>
          </Link>

          <Link to="/users" className="dashboard-admin-card dashboard-admin-card-users">
            <div className="dashboard-admin-card-icon" aria-hidden>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </div>
            <h2 className="dashboard-admin-card-title">Users</h2>
            <p className="dashboard-admin-card-desc">Manage users and roles</p>
            <div className="dashboard-admin-stats">
              <div className="dashboard-admin-stat dashboard-admin-stat-active">
                <span className="dashboard-admin-stat-dot" />
                <span className="dashboard-admin-stat-value">{userStats?.active ?? "—"}</span>
                <span className="dashboard-admin-stat-label">Active</span>
              </div>
              <div className="dashboard-admin-stat dashboard-admin-stat-inactive">
                <span className="dashboard-admin-stat-dot" />
                <span className="dashboard-admin-stat-value">{userStats?.inactive ?? "—"}</span>
                <span className="dashboard-admin-stat-label">Inactive</span>
              </div>
            </div>
          </Link>
        </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container app-page dashboard-page">
      <div className="dashboard-panel">
      <header className="dashboard-header">
        <h1>Dashboard</h1>
        <p className="dashboard-welcome">Welcome back, <strong>{user?.username}</strong></p>
      </header>

      {planLimits && planLimits.plan_name && (
        <div className={`dashboard-plan-card ${planExpired ? "dashboard-plan-expired" : planUrgent ? "dashboard-plan-urgent" : ""}`}>
          <div className="dashboard-plan-info">
            <span className="dashboard-plan-name">{planLimits.plan_name}</span>
            <span className="dashboard-plan-days">
              {planDaysLeft === null ? "" : planDaysLeft >= 0 ? `${planDaysLeft} days left` : `${Math.abs(planDaysLeft)} days overdue`}
            </span>
          </div>
          {planExpired && (
            <Link to="/plan-billing/plan" className="dashboard-plan-renew">Renew plan</Link>
          )}
        </div>
      )}

      <div className="dashboard-cards">
        <div className="dashboard-card dashboard-card-link" onClick={() => navigate("/server/access")} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && navigate("/server/access")}>
          <div className="dashboard-card-link-inner">
            <span className="dashboard-card-link-icon">Server</span>
            <span className="dashboard-card-link-text">Servers</span>
            <span className="dashboard-card-link-desc">
              {serverStats?.assigned_count !== undefined
                ? `${serverStats.assigned_count} assigned server(s)`
                : "Connect to your servers"}
            </span>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}
