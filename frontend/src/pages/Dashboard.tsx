import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
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

type MyGroups = {
  user_groups: { id: string; name: string }[];
  server_groups: { id: string; name: string; role: string }[];
  servers: { id: string; hostname: string; friendly_name: string | null; ip_address: string | null; source: string; source_name: string | null }[];
};

export default function Dashboard() {
  const { user, isAdmin } = useAuth();
  const [serverStats, setServerStats] = useState<ServerStats | null>(null);
  const [userStats, setUserStats] = useState<UserStats | null>(null);
  const [myGroups, setMyGroups] = useState<MyGroups | null>(null);

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
    api.get<MyGroups>("/api/users/me/groups").then(setMyGroups).catch(() => setMyGroups(null));
  }, []);

  if (isAdmin) {
    return (
      <div className="container app-page dashboard-page">
        <div className="dashboard-panel">
        <header className="dashboard-header">
          <h1>Dashboard</h1>
          <p className="dashboard-welcome">Welcome back, <strong>{user?.username}</strong></p>
        </header>

        <div className="dashboard-admin-cards">
          <Link to="/server" className="dashboard-admin-card dashboard-admin-card-servers">
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

      <div className="dashboard-cards">
        <div className="dashboard-card dashboard-card-link">
          <Link to="/server" className="dashboard-card-link-inner">
            <span className="dashboard-card-link-icon">Server</span>
            <span className="dashboard-card-link-text">Servers</span>
            <span className="dashboard-card-link-desc">
              {serverStats?.assigned_count !== undefined
                ? `${serverStats.assigned_count} assigned server(s)`
                : "Your connected servers"}
            </span>
          </Link>
        </div>
      </div>

      {myGroups && (myGroups.user_groups.length > 0 || myGroups.server_groups.length > 0 || myGroups.servers.length > 0) && (
        <section className="card" style={{ marginTop: "1.5rem" }}>
          <h2 className="card-subtitle">Your groups & servers</h2>
          {myGroups.user_groups.length > 0 && (
            <p style={{ marginBottom: "0.5rem" }}>
              <strong>User groups:</strong> {myGroups.user_groups.map((g) => g.name).join(", ")}
            </p>
          )}
          {myGroups.server_groups.length > 0 && (
            <p style={{ marginBottom: "0.5rem" }}>
              <strong>Server groups:</strong> {myGroups.server_groups.map((g) => `${g.name} (${g.role})`).join(", ")}
            </p>
          )}
          {myGroups.servers.length > 0 && (
            <>
              <p style={{ marginBottom: "0.5rem" }}><strong>Servers you can access:</strong></p>
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {myGroups.servers.map((s) => (
                  <li key={s.id} style={{ padding: "0.35rem 0", borderBottom: "1px solid var(--border)" }}>
                    <Link to={`/server/${s.id}`}>{s.friendly_name || s.hostname}</Link>
                    <span className="text-muted" style={{ fontSize: "0.85rem", marginLeft: "0.5rem" }}>
                      {s.source === "direct" && "(direct access)"}
                      {s.source === "server_group" && s.source_name && `(via server group: ${s.source_name})`}
                      {s.source === "user_group" && s.source_name && `(via user group: ${s.source_name})`}
                      {s.source === "admin" && "(admin)"}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
      </div>
    </div>
  );
}
