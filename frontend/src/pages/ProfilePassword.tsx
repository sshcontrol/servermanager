import { useState } from "react";
import { api } from "../api/client";
import { validatePassword } from "../utils/password";
import PasswordField from "../components/PasswordField";

export default function ProfilePassword() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    const pwdErr = validatePassword(newPassword);
    if (pwdErr) {
      setMessage({ type: "error", text: pwdErr });
      return;
    }
    if (newPassword !== confirmPassword) {
      setMessage({ type: "error", text: "New password and confirmation do not match." });
      return;
    }
    setSaving(true);
    try {
      await api.post("/api/auth/change-password", { current_password: currentPassword, new_password: newPassword });
      setMessage({ type: "success", text: "Password changed." });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : "Failed to change password" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="profile-section">
      <div className="profile-section-card">
        <h2 className="profile-section-title">Change password</h2>
        <p className="profile-section-desc">Enter your current password and type the new password twice to confirm.</p>
        <form onSubmit={changePassword}>
          <div className="form-group">
            <label htmlFor="current-password">Current password</label>
            <input id="current-password" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required autoComplete="current-password" />
          </div>
          <PasswordField
            id="new-password"
            value={newPassword}
            onChange={setNewPassword}
            label="New password"
            placeholder="Enter new password"
          />
          <div className="form-group">
            <label htmlFor="confirm-password">Confirm new password</label>
            <input id="confirm-password" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required minLength={8} autoComplete="new-password" />
          </div>
          <button type="submit" className="primary" disabled={saving}>{saving ? "Changing…" : "Change password"}</button>
        </form>
        {message && <p className={message.type === "error" ? "error-msg" : "success-msg"} style={{ marginTop: "0.75rem" }}>{message.text}</p>}
      </div>
    </div>
  );
}
