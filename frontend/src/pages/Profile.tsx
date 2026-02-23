import { useState, useEffect } from "react";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../api/client";
import { COUNTRY_CODES, toE164, fromE164, isValidE164 } from "../lib/phone";

export function ProfileAccount() {
  const { user, refreshUser } = useAuth();
  const [username, setUsername] = useState(user?.username ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const { countryCode: initialCountry, nationalNumber: initialPhone } = fromE164(user?.phone ?? undefined);
  const [phoneCountryCode, setPhoneCountryCode] = useState(initialCountry || "+1");
  const [phoneNumber, setPhoneNumber] = useState(initialPhone || "");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);

  useEffect(() => {
    setUsername(user?.username ?? "");
    setEmail(user?.email ?? "");
    const { countryCode, nationalNumber } = fromE164(user?.phone ?? undefined);
    setPhoneCountryCode(countryCode || "+1");
    setPhoneNumber(nationalNumber || "");
  }, [user?.username, user?.email, user?.phone]);

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileMessage(null);
    const phone = toE164(phoneCountryCode, phoneNumber);
    if (phone && !isValidE164(phone)) {
      setProfileMessage({ type: "error", text: "Please enter a valid phone number with country code." });
      return;
    }
    setProfileSaving(true);
    try {
      await api.patch("/api/users/me", {
        username: username.trim() || undefined,
        email: email.trim() || undefined,
        phone: phone || undefined,
      });
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
        <p className="profile-section-desc">Update your username, email, and phone number.</p>
        <form onSubmit={saveProfile}>
          <div className="form-group">
            <label htmlFor="profile-username">Username</label>
            <input id="profile-username" type="text" value={username} onChange={(e) => setUsername(e.target.value)} minLength={2} maxLength={100} required />
          </div>
          <div className="form-group">
            <label htmlFor="profile-email">Email</label>
            <input id="profile-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="form-group">
            <label htmlFor="profile-phone">Phone (with country code)</label>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
              <select id="profile-phone" value={phoneCountryCode} onChange={(e) => setPhoneCountryCode(e.target.value)} style={{ minWidth: "120px" }}>
                {COUNTRY_CODES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
              </select>
              <input type="tel" value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value.replace(/\D/g, "").slice(0, 15))} placeholder="2345678900" style={{ flex: "1", minWidth: "140px" }} />
            </div>
            <p className="form-hint">Used for SMS verification. Enter number without leading zero.</p>
          </div>
          <button type="submit" className="primary" disabled={profileSaving}>{profileSaving ? "Saving…" : "Save changes"}</button>
        </form>
        {profileMessage && <p className={profileMessage.type === "error" ? "error-msg" : "success-msg"} style={{ marginTop: "0.75rem" }}>{profileMessage.text}</p>}
      </div>
    </div>
  );
}

export { ProfileAccount as default };
