import { useState, useEffect } from "react";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../api/client";

export function ProfileAccount() {
  const { user, refreshUser } = useAuth();
  const canEditCompany = user?.is_tenant_owner === true;

  const [username, setUsername] = useState(user?.username ?? "");
  const [companyName, setCompanyName] = useState(user?.company_name ?? "");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);

  useEffect(() => {
    setUsername(user?.username ?? "");
    setCompanyName(user?.company_name ?? "");
  }, [user?.username, user?.company_name]);

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileMessage(null);
    setProfileSaving(true);
    try {
      await api.patch("/api/users/me", {
        username: username.trim() || undefined,
      });
      if (canEditCompany) {
        await api.patch("/api/tenant/me", { company_name: companyName.trim() });
      }
      setProfileMessage({ type: "success", text: "Profile updated." });
      await refreshUser();
    } catch (e) {
      setProfileMessage({ type: "error", text: e instanceof Error ? e.message : "Failed to update profile" });
    } finally {
      setProfileSaving(false);
    }
  };

  return (
    <div className="profile-section">
      <div className="profile-section-card">
        <h2 className="profile-section-title">Account details</h2>
        <p className="profile-section-desc">Update your username. Email cannot be changed.</p>
        <form onSubmit={saveProfile}>
          <div className="form-group">
            <label htmlFor="profile-username">Username</label>
            <input id="profile-username" type="text" value={username} onChange={(e) => setUsername(e.target.value)} minLength={2} maxLength={100} required />
          </div>
          {canEditCompany && (
            <div className="form-group">
              <label htmlFor="profile-company">Company name</label>
              <input id="profile-company" type="text" value={companyName} onChange={(e) => setCompanyName(e.target.value)} maxLength={255} placeholder="Your company or organization" />
              <p className="form-hint">Shown in the dashboard sidebar. Only the tenant owner can edit this.</p>
            </div>
          )}
          <div className="form-group">
            <label htmlFor="profile-email">Email</label>
            <input id="profile-email" type="email" value={user?.email ?? ""} readOnly disabled style={{ opacity: 0.8, cursor: "not-allowed" }} />
            <p className="form-hint">Email address cannot be changed. <a href="mailto:info@sshcontrol.com" style={{ color: "var(--accent)", textDecoration: "none" }}>Contact support</a> if you need to update it.</p>
          </div>
          <button type="submit" className="primary" disabled={profileSaving}>{profileSaving ? "Saving…" : "Save changes"}</button>
        </form>
        {profileMessage && <p className={profileMessage.type === "error" ? "error-msg" : "success-msg"} style={{ marginTop: "0.75rem" }}>{profileMessage.text}</p>}
      </div>
    </div>
  );
}

export { ProfileAccount as default };
