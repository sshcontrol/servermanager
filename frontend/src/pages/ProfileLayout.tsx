import { NavLink, Outlet } from "react-router-dom";

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
    case "delete-account": return <Icon><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></Icon>;
    default: return null;
  }
};

export default function ProfileLayout() {
  const base = "/profile";

  const tabs: { path: string; label: string; danger?: boolean }[] = [
    { path: `${base}/account`, label: "Account" },
    { path: `${base}/password`, label: "Password" },
    { path: `${base}/security`, label: "Security" },
    { path: `${base}/delete-account`, label: "Delete account", danger: true },
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
            className={({ isActive }) => `profile-tab${t.danger ? " profile-tab-danger" : ""}${isActive ? " active" : ""}`}
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
