import { useState, useEffect, useCallback } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import Logo from "./Logo";
import ConfirmModal from "./ConfirmModal";

const iconSize = 20;

const NavIcon = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <span className={`app-nav-icon ${className}`} style={{ width: iconSize, height: iconSize, flexShrink: 0 }} aria-hidden>
    {children}
  </span>
);

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, logout, isAdmin, isPlatformSuperadmin } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const path = location.pathname;

  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const handleLogout = useCallback(() => {
    setLogoutConfirmOpen(false);
    logout();
    navigate("/", { replace: true });
  }, [logout, navigate]);

  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  useEffect(() => {
    closeSidebar();
    if (path === "/") setOpenMenu(null);
    else if (path.startsWith("/superadmin")) setOpenMenu("superadmin");
    else if (path.startsWith("/server-groups") || path.startsWith("/server")) setOpenMenu("server");
    else if (path.startsWith("/user-groups") || path.startsWith("/users")) setOpenMenu("user");
    else if (path.startsWith("/security")) setOpenMenu("security");
    else if (path.startsWith("/profile")) setOpenMenu("profile");
    else if (path === "/monitor") setOpenMenu(null);
    else if (path === "/history") setOpenMenu(null);
  }, [path, closeSidebar]);

  const navClass = (p: string) => (path === p ? "app-nav-link active" : "app-nav-link");
  const subClass = (p: string) => (path === p ? "app-nav-sublink active" : "app-nav-sublink");

  const toggle = (key: string) => {
    setOpenMenu((m) => (m === key ? null : key));
  };

  return (
    <div className="app-shell">
      <header className="app-topbar">
        <div className="app-topbar-left">
          <span className="app-topbar-user">{user?.full_name || user?.username}</span>
          {user?.company_name && <span className="app-topbar-company">{user.company_name}</span>}
        </div>
        <div className="app-topbar-right">
          {isAdmin && !isPlatformSuperadmin && (
            <>
              <Link to="/monitor" className={`app-topbar-link${path === "/monitor" ? " active" : ""}`}>
                <NavIcon><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg></NavIcon>
                User monitor
              </Link>
              <Link to="/history" className={`app-topbar-link${path === "/history" ? " active" : ""}`}>
                <NavIcon><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></NavIcon>
                History
              </Link>
            </>
          )}
          <button type="button" className="app-topbar-link app-topbar-logout" onClick={() => setLogoutConfirmOpen(true)}>
            <NavIcon><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/></svg></NavIcon>
            Logout
          </button>
        </div>
      </header>
      <button
        type="button"
        className="sidebar-hamburger"
        onClick={() => setSidebarOpen((v) => !v)}
        aria-label="Toggle navigation"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="3" x2="21" y1="6" y2="6"/><line x1="3" x2="21" y1="12" y2="12"/><line x1="3" x2="21" y1="18" y2="18"/>
        </svg>
      </button>
      {sidebarOpen && <div className="sidebar-backdrop" onClick={closeSidebar} />}
      <div className="app-shell-body">
      <aside className={`app-sidebar${sidebarOpen ? " open" : ""}`}>
        <Link to="/" className="app-sidebar-brand" aria-label="Dashboard">
          <Logo compact animated />
        </Link>
        <nav className="app-sidebar-nav" aria-label="Main">
          {!isPlatformSuperadmin && (
            <Link to="/" className={navClass("/")}>
              <NavIcon>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/></svg>
                </NavIcon>
              Dashboard
            </Link>
          )}

          {!isPlatformSuperadmin && (<div className="app-nav-group">
            <button
              type="button"
              className={`app-nav-group-btn ${openMenu === "server" ? "open" : ""}`}
              onClick={() => toggle("server")}
              aria-expanded={openMenu === "server"}
            >
              <span className="app-nav-group-btn-inner">
                <NavIcon>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="8" x="2" y="2" rx="2"/><rect width="20" height="8" x="2" y="14" rx="2"/><path d="M6 6v.01M6 18v.01M18 6v.01M18 18v.01"/></svg>
                </NavIcon>
                Server
              </span>
            </button>
            {openMenu === "server" && (
              <div className="app-nav-sublinks">
                {isAdmin ? (
                  <>
                    <Link to="/server/add" className={subClass("/server/add")}>
                      <NavIcon>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
                      </NavIcon>
                      Add server
                    </Link>
                    <Link to="/server" className={subClass("/server")}>
                      <NavIcon>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/></svg>
                      </NavIcon>
                      Modify servers
                    </Link>
                    <Link to="/server-groups" className={subClass("/server-groups")}>
                      <NavIcon>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="8" x="2" y="2" rx="2"/><rect width="20" height="8" x="2" y="14" rx="2"/><path d="M6 6v.01M6 18v.01"/></svg>
                      </NavIcon>
                      Server groups
                    </Link>
                  </>
                ) : (
                  <Link to="/server" className={subClass("/server")}>
                    <NavIcon>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="8" x="2" y="2" rx="2"/><rect width="20" height="8" x="2" y="14" rx="2"/></svg>
                    </NavIcon>
                    Servers
                  </Link>
                )}
              </div>
            )}
          </div>)}

          {isAdmin && !isPlatformSuperadmin && (
            <>
              <div className="app-nav-group">
                <button
                  type="button"
                  className={`app-nav-group-btn ${openMenu === "user" ? "open" : ""}`}
                  onClick={() => toggle("user")}
                  aria-expanded={openMenu === "user"}
                >
                  <span className="app-nav-group-btn-inner">
                    <NavIcon>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                    </NavIcon>
                    User
                  </span>
                </button>
                {openMenu === "user" && (
                  <div className="app-nav-sublinks">
                    <Link to="/users/add" className={subClass("/users/add")}>
                      <NavIcon>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6"/><path d="M22 11h-6"/></svg>
                      </NavIcon>
                      Add user
                    </Link>
                    <Link to="/users" className={subClass("/users")}>
                      <NavIcon>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                      </NavIcon>
                      Modify users
                    </Link>
                    <Link to="/user-groups" className={subClass("/user-groups")}>
                      <NavIcon>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                      </NavIcon>
                      User groups
                    </Link>
                  </div>
                )}
              </div>
            </>
          )}

          {isAdmin && !isPlatformSuperadmin && (
            <div className="app-nav-group">
              <button
                type="button"
                className={`app-nav-group-btn ${openMenu === "security" ? "open" : ""}`}
                onClick={() => toggle("security")}
                aria-expanded={openMenu === "security"}
              >
                <span className="app-nav-group-btn-inner">
                  <NavIcon>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                  </NavIcon>
                  Security
                </span>
              </button>
              {openMenu === "security" && (
                <div className="app-nav-sublinks">
                  <Link to="/security/whitelist-ip" className={subClass("/security/whitelist-ip")}>
                    <NavIcon>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                    </NavIcon>
                    Whitelist IP
                  </Link>
                  <span className="app-nav-sublink app-nav-sublink-disabled" title="Coming soon">
                    <NavIcon>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12h20"/><path d="M12 2v20"/><path d="M5 5l14 14"/></svg>
                    </NavIcon>
                    VPN <span style={{ fontSize: "0.75rem", opacity: 0.8 }}>(coming soon)</span>
                  </span>
                </div>
              )}
            </div>
          )}

          {isPlatformSuperadmin && (
            <div className="app-nav-group">
              <button
                type="button"
                className={`app-nav-group-btn ${openMenu === "superadmin" ? "open" : ""}`}
                onClick={() => toggle("superadmin")}
                aria-expanded={openMenu === "superadmin"}
              >
                <span className="app-nav-group-btn-inner">
                  <NavIcon>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>
                  </NavIcon>
                  Superadmin
                </span>
              </button>
              {openMenu === "superadmin" && (
                <div className="app-nav-sublinks">
                  <Link to="/superadmin/tenants" className={subClass("/superadmin/tenants")}>
                    <NavIcon>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                    </NavIcon>
                    Tenants
                  </Link>
                  <Link to="/superadmin/plans" className={subClass("/superadmin/plans")}>
                    <NavIcon>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v3"/><path d="M12 12v.01"/></svg>
                    </NavIcon>
                    Plans
                  </Link>
                  <Link to="/superadmin/email" className={subClass("/superadmin/email")}>
                    <NavIcon>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                    </NavIcon>
                    Email
                  </Link>
                  <Link to="/superadmin/backup" className={subClass("/superadmin/backup")}>
                    <NavIcon>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
                    </NavIcon>
                    Backup
                  </Link>
                </div>
              )}
            </div>
          )}

          <div className="app-nav-group">
            <button
              type="button"
              className={`app-nav-group-btn ${openMenu === "profile" ? "open" : ""}`}
              onClick={() => toggle("profile")}
              aria-expanded={openMenu === "profile"}
            >
              <span className="app-nav-group-btn-inner">
                <NavIcon>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-1.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h1.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v1.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-1.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                </NavIcon>
                Profile
              </span>
            </button>
            {openMenu === "profile" && (
              <div className="app-nav-sublinks">
                <Link to="/profile/account" className={subClass("/profile/account")}>
                  <NavIcon>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                  </NavIcon>
                  Profile
                </Link>
                {!isPlatformSuperadmin && (
                  <Link to="/profile/keys" className={subClass("/profile/keys")}>
                    <NavIcon>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 7a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h10z"/><path d="M12 12v.01"/><path d="M12 12a1 1 0 1 0 0-2 1 1 0 0 0 0 2z"/></svg>
                    </NavIcon>
                    Key
                  </Link>
                )}
                {isAdmin && !isPlatformSuperadmin && (
                  <Link to="/profile/plan" className={subClass("/profile/plan")}>
                    <NavIcon>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/></svg>
                    </NavIcon>
                    Plan
                  </Link>
                )}
                {isAdmin && (
                  <Link to="/profile/import-export" className={subClass("/profile/import-export")}>
                    <NavIcon>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
                    </NavIcon>
                    History Export
                  </Link>
                )}
              </div>
            )}
          </div>

        </nav>
        <div className="app-sidebar-footer">
          <div className="app-sidebar-user">
            {user?.company_name && <span className="app-sidebar-company">{user.company_name}</span>}
            <span className="app-sidebar-username">{user?.full_name || user?.username}</span>
            <span className="app-sidebar-role">Role: {isPlatformSuperadmin ? "Platform Superadmin" : (isAdmin ? "Admin" : "User")}</span>
          </div>
        </div>
      </aside>
      <main className="app-main">{children}</main>
      </div>
      <ConfirmModal
        open={logoutConfirmOpen}
        title="Log out"
        message="Are you sure you want to log out?"
        confirmLabel="Log out"
        cancelLabel="Cancel"
        danger
        onConfirm={handleLogout}
        onCancel={() => setLogoutConfirmOpen(false)}
      />
    </div>
  );
}
