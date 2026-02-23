import { lazy, Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./contexts/AuthContext";
import LogoSpinner from "./components/LogoSpinner";
import ScrollToTop from "./components/ScrollToTop";
import Login from "./pages/Login";
import Landing from "./pages/Landing";

const AppLayout = lazy(() => import("./components/AppLayout"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const ServerAdd = lazy(() => import("./pages/ServerAdd"));
const ServerList = lazy(() => import("./pages/ServerList"));
const ServerDetail = lazy(() => import("./pages/ServerDetail"));
const ServerGroupsList = lazy(() => import("./pages/ServerGroupsList"));
const ServerGroupDetail = lazy(() => import("./pages/ServerGroupDetail"));
const UserGroupsList = lazy(() => import("./pages/UserGroupsList"));
const UserGroupDetail = lazy(() => import("./pages/UserGroupDetail"));
const AddUser = lazy(() => import("./pages/AddUser"));
const ModifyUsers = lazy(() => import("./pages/ModifyUsers"));
const OnlineUsers = lazy(() => import("./pages/OnlineUsers"));
const History = lazy(() => import("./pages/History"));
const ProfileLayout = lazy(() => import("./pages/ProfileLayout"));
const Profile = lazy(() => import("./pages/Profile"));
const ProfilePassword = lazy(() => import("./pages/ProfilePassword"));
const ProfileSecurity = lazy(() => import("./pages/ProfileSecurity"));
const ProfileKeys = lazy(() => import("./pages/ProfileKeys"));
const ProfilePlan = lazy(() => import("./pages/ProfilePlan"));
const ProfileImportExport = lazy(() => import("./pages/ProfileImportExport"));
const SecurityWhitelistIp = lazy(() => import("./pages/SecurityWhitelistIp"));
const SecurityVpn = lazy(() => import("./pages/SecurityVpn"));

// New multi-tenant pages
const Signup = lazy(() => import("./pages/Signup"));
const VerifyEmail = lazy(() => import("./pages/VerifyEmail"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const Welcome = lazy(() => import("./pages/Welcome"));
const SuperadminTenants = lazy(() => import("./pages/SuperadminTenants"));
const SuperadminPlans = lazy(() => import("./pages/SuperadminPlans"));
const SuperadminEmail = lazy(() => import("./pages/SuperadminEmail"));
const SuperadminBackup = lazy(() => import("./pages/SuperadminBackup"));
const PublicPlans = lazy(() => import("./pages/PublicPlans"));
const AcceptInvitation = lazy(() => import("./pages/AcceptInvitation"));

function ProtectedRoute({ children, adminOnly, superadminOnly }: { children: React.ReactNode; adminOnly?: boolean; superadminOnly?: boolean }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="app-loading"><LogoSpinner /></div>;
  if (!user) return <Navigate to="/" replace />;

  // Redirect to onboarding if not completed
  if (!user.onboarding_completed && !superadminOnly) {
    return <Navigate to="/welcome" replace />;
  }

  if (superadminOnly) {
    if (!user.is_superuser || user.tenant_id) return <Navigate to="/" replace />;
  } else if (adminOnly) {
    const isAdmin = user.is_superuser || user.roles?.some((r) => r.name === "admin");
    if (!isAdmin) return <Navigate to="/" replace />;
  }
  return (
    <Suspense fallback={<div className="app-loading"><LogoSpinner /></div>}>
      <AppLayout>{children}</AppLayout>
    </Suspense>
  );
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="app-loading"><LogoSpinner /></div>;
  if (user) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function HomeRoute() {
  const { user, loading, isPlatformSuperadmin } = useAuth();
  if (loading) return <div className="app-loading"><LogoSpinner /></div>;
  if (!user) return <Landing />;
  if (isPlatformSuperadmin) return <Navigate to="/superadmin/tenants" replace />;
  if (!user.onboarding_completed) return <Navigate to="/welcome" replace />;
  return (
    <ProtectedRoute>
      <Suspense fallback={<div className="app-loading"><LogoSpinner /></div>}>
        <Dashboard />
      </Suspense>
    </ProtectedRoute>
  );
}

export default function App() {
  return (
    <>
    <ScrollToTop />
    <Routes>
      {/* Public auth routes */}
      <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
      <Route path="/signup" element={<PublicRoute><Suspense fallback={<div className="app-loading"><LogoSpinner /></div>}><Signup /></Suspense></PublicRoute>} />
      <Route path="/verify-email" element={<Suspense fallback={<div className="app-loading"><LogoSpinner /></div>}><VerifyEmail /></Suspense>} />
      <Route path="/forgot-password" element={<PublicRoute><Suspense fallback={<div className="app-loading"><LogoSpinner /></div>}><ForgotPassword /></Suspense></PublicRoute>} />
      <Route path="/reset-password" element={<Suspense fallback={<div className="app-loading"><LogoSpinner /></div>}><ResetPassword /></Suspense>} />
      <Route path="/plans" element={<Suspense fallback={<div className="app-loading"><LogoSpinner /></div>}><PublicPlans /></Suspense>} />
      <Route path="/accept-invitation" element={<Suspense fallback={<div className="app-loading"><LogoSpinner /></div>}><AcceptInvitation /></Suspense>} />

      {/* Onboarding */}
      <Route path="/welcome" element={<Suspense fallback={<div className="app-loading"><LogoSpinner /></div>}><Welcome /></Suspense>} />

      {/* Main app routes */}
      <Route path="/" element={<HomeRoute />} />
      <Route path="/server/add" element={<ProtectedRoute adminOnly><ServerAdd /></ProtectedRoute>} />
      <Route path="/server/:id" element={<ProtectedRoute><ServerDetail /></ProtectedRoute>} />
      <Route path="/server" element={<ProtectedRoute><ServerList /></ProtectedRoute>} />
      <Route path="/server-groups" element={<ProtectedRoute adminOnly><ServerGroupsList /></ProtectedRoute>} />
      <Route path="/server-groups/:id" element={<ProtectedRoute adminOnly><ServerGroupDetail /></ProtectedRoute>} />
      <Route path="/user-groups" element={<ProtectedRoute adminOnly><UserGroupsList /></ProtectedRoute>} />
      <Route path="/user-groups/:id" element={<ProtectedRoute adminOnly><UserGroupDetail /></ProtectedRoute>} />
      <Route path="/users/add" element={<ProtectedRoute adminOnly><AddUser /></ProtectedRoute>} />
      <Route path="/users" element={<ProtectedRoute adminOnly><ModifyUsers /></ProtectedRoute>} />
      <Route path="/monitor" element={<ProtectedRoute adminOnly><OnlineUsers /></ProtectedRoute>} />
      <Route path="/history" element={<ProtectedRoute adminOnly><History /></ProtectedRoute>} />
      <Route path="/security/whitelist-ip" element={<ProtectedRoute adminOnly><SecurityWhitelistIp /></ProtectedRoute>} />
      <Route path="/security/vpn" element={<ProtectedRoute adminOnly><SecurityVpn /></ProtectedRoute>} />
      <Route path="/profile" element={<ProtectedRoute><ProfileLayout /></ProtectedRoute>}>
        <Route index element={<Navigate to="/profile/account" replace />} />
        <Route path="account" element={<Profile />} />
        <Route path="password" element={<ProfilePassword />} />
        <Route path="security" element={<ProfileSecurity />} />
        <Route path="keys" element={<ProfileKeys embedded />} />
        <Route path="plan" element={<ProfilePlan embedded />} />
        <Route path="import-export" element={<ProfileImportExport embedded />} />
      </Route>

      {/* Superadmin routes (platform owner only) */}
      <Route path="/superadmin/tenants" element={<ProtectedRoute superadminOnly><SuperadminTenants /></ProtectedRoute>} />
      <Route path="/superadmin/plans" element={<ProtectedRoute superadminOnly><SuperadminPlans /></ProtectedRoute>} />
      <Route path="/superadmin/email" element={<ProtectedRoute superadminOnly><SuperadminEmail /></ProtectedRoute>} />
      <Route path="/superadmin/backup" element={<ProtectedRoute superadminOnly><SuperadminBackup /></ProtectedRoute>} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </>
  );
}
