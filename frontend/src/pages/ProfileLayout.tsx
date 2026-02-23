import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

const tabIcon = (name: string) => {
  const Icon = ({ children }: { children: React.ReactNode }) => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
  switch (name) {
    case "account": return <Icon><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></Icon>;
    case "password": return <Icon><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></Icon>;
    case "security": return <Icon><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></Icon>;
    case "keys": return <Icon><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></Icon>;
    case "plan": return <Icon><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v3"/></Icon>;
    case "history":
    case "import-export": return <Icon><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></Icon>;
    default: return null;
  }
};

export default function ProfileLayout() {
  const { isAdmin, isPlatformSuperadmin } = useAuth();
  const base = "/profile";

  const tabs = [
    { path: `${base}/account`, label: "Account" },
    { path: `${base}/password`, label: "Password" },
    { path: `${base}/security`, label: "Security" },
    { path: `${base}/keys`, label: "SSH Key" },
    ...(isAdmin && !isPlatformSuperadmin ? [
      { path: `${base}/plan`, label: "Plan" },
      { path: `${base}/import-export`, label: "History Export" },
    ] : []),
  ];

  return (
    <div className="container app-page profile-page">
      <div className="profile-page-header">
        <h1>Profile</h1>
        <p className="profile-page-subtitle">Manage your account settings</p>
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
