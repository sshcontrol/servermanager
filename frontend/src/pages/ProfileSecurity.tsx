import { useState, useEffect } from "react";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../api/client";
import { normalizeToE164, isValidE164 } from "../lib/phone";
import Toggle from "../components/Toggle";

type QRCodeProps = { value: string; size?: number; level?: string; bgColor?: string; fgColor?: string };

export default function ProfileSecurity() {
  const { user, refreshUser } = useAuth();
  const [QRCodeSVG, setQRCodeSVG] = useState<React.ComponentType<QRCodeProps> | null>(null);
  const [totpSetup, setTotpSetup] = useState<{ secret: string; provisioning_uri: string; qr_uri: string } | null>(null);
  const [totpVerifyCode, setTotpVerifyCode] = useState("");
  const [totpDisablePassword, setTotpDisablePassword] = useState("");
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const [phone, setPhone] = useState(user?.phone ?? "");
  const [phoneSaving, setPhoneSaving] = useState(false);
  const [phoneVerifyCode, setPhoneVerifyCode] = useState("");
  const [phoneStep, setPhoneStep] = useState<"enter" | "verify">("enter");
  const [editingPhone, setEditingPhone] = useState(false);
  const [phoneChangePassword, setPhoneChangePassword] = useState("");
  const [smsToggleLoading, setSmsToggleLoading] = useState(false);
  const [smsDisablePassword, setSmsDisablePassword] = useState("");
  const [showSmsDisableConfirm, setShowSmsDisableConfirm] = useState(false);

  useEffect(() => {
    import("qrcode.react")
      .then((mod) => setQRCodeSVG(mod.QRCodeSVG as React.ComponentType<QRCodeProps>))
      .catch(() => setQRCodeSVG(null));
  }, []);

  useEffect(() => {
    setPhone(user?.phone ?? "");
  }, [user?.phone]);

  const requestPhoneCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    const phoneE164 = phone.trim() ? normalizeToE164(phone) : "";
    if (!phoneE164 || !isValidE164(phoneE164)) {
      setMessage({ type: "error", text: "Please enter a valid phone number with country code." });
      return;
    }
    setPhoneSaving(true);
    try {
      await api.post("/api/auth/request-phone-verification", { phone: phoneE164 });
      setMessage({ type: "success", text: "Verification code sent to your phone." });
      setPhoneStep("verify");
      setPhoneVerifyCode("");
      await refreshUser();
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : "Failed to send code" });
    } finally {
      setPhoneSaving(false);
    }
  };

  const verifyPhone = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    const phoneE164 = phone.trim() ? normalizeToE164(phone) : "";
    if (!phoneE164 || !isValidE164(phoneE164) || phoneVerifyCode.length < 4) {
      setMessage({ type: "error", text: "Enter the 4-digit code from your phone." });
      return;
    }
    setPhoneSaving(true);
    try {
      await api.post("/api/auth/verify-phone", { phone: phoneE164, code: phoneVerifyCode });
      setMessage({ type: "success", text: editingPhone && user?.phone_verified ? "Phone number updated." : "Phone verified. It can no longer be changed by you; contact your administrator if needed." });
      setPhoneStep("enter");
      setPhoneVerifyCode("");
      setEditingPhone(false);
      setPhoneChangePassword("");
      await refreshUser();
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : "Verification failed" });
    } finally {
      setPhoneSaving(false);
    }
  };

  const requestPhoneChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    const phoneE164 = phone.trim() ? normalizeToE164(phone) : "";
    if (!phoneE164 || !isValidE164(phoneE164)) {
      setMessage({ type: "error", text: "Please enter a valid phone number with country code." });
      return;
    }
    if (!phoneChangePassword.trim()) {
      setMessage({ type: "error", text: "Password is required to change a verified phone." });
      return;
    }
    setPhoneSaving(true);
    try {
      await api.post("/api/auth/request-phone-change", { phone: phoneE164, password: phoneChangePassword });
      setMessage({ type: "success", text: "Verification code sent to your new phone." });
      setPhoneStep("verify");
      setPhoneVerifyCode("");
      setPhoneChangePassword("");
      await refreshUser();
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to send code" });
    } finally {
      setPhoneSaving(false);
    }
  };

  const toggleSmsVerification = async (enabled: boolean) => {
    if (!enabled && user?.sms_verification_enabled) {
      if (user?.is_google_user) {
        await doToggleSmsVerification(false, undefined);
        return;
      }
      setShowSmsDisableConfirm(true);
      setSmsDisablePassword("");
      setMessage(null);
      return;
    }
    await doToggleSmsVerification(enabled, undefined);
  };

  const doToggleSmsVerification = async (enabled: boolean, password?: string) => {
    setMessage(null);
    setSmsToggleLoading(true);
    setShowSmsDisableConfirm(false);
    try {
      await api.post("/api/auth/sms-verification/toggle", { enabled, password: password ?? undefined });
      setMessage({ type: "success", text: `SMS verification ${enabled ? "enabled" : "disabled"}.` });
      setSmsDisablePassword("");
      await refreshUser();
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : "Failed to update" });
      if (!enabled) setShowSmsDisableConfirm(true);
    } finally {
      setSmsToggleLoading(false);
    }
  };

  const startTotpSetup = async () => {
    setMessage(null);
    setTotpSetup(null);
    setLoading(true);
    try {
      const res = await api.post<{ secret: string; provisioning_uri: string; qr_uri: string }>("/api/auth/totp/setup");
      setTotpSetup(res);
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : "Failed to setup TOTP" });
    } finally {
      setLoading(false);
    }
  };

  const verifyTotp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!totpVerifyCode.trim()) return;
    setMessage(null);
    setLoading(true);
    try {
      await api.post("/api/auth/totp/verify", { code: totpVerifyCode.trim() });
      setMessage({ type: "success", text: "TOTP enabled." });
      setTotpSetup(null);
      setTotpVerifyCode("");
      await refreshUser();
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : "Invalid code" });
    } finally {
      setLoading(false);
    }
  };

  const disableTotp = async (e: React.FormEvent) => {
    e.preventDefault();
    const isGoogleUser = user?.is_google_user === true;
    if (!isGoogleUser && !totpDisablePassword) return;
    setMessage(null);
    setLoading(true);
    try {
      await api.post("/api/auth/totp/disable", { password: isGoogleUser ? undefined : totpDisablePassword });
      setMessage({ type: "success", text: "TOTP disabled." });
      setTotpDisablePassword("");
      await refreshUser();
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : "Failed to disable TOTP" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="profile-section">
      <div className="profile-section-card">
        <h2 className="profile-section-title">Two-factor authentication</h2>
        <p className="profile-section-desc">
          Two-factor authentication: <strong>{user?.totp_enabled ? "enabled" : "disabled"}</strong>.
        </p>

        {!user?.totp_enabled && (
          <>
            {!totpSetup ? (
              <button type="button" onClick={startTotpSetup} disabled={loading} className="primary">
                {loading ? "Setting up…" : "Setup TOTP"}
              </button>
            ) : (
              <form onSubmit={verifyTotp}>
                <p className="profile-section-desc" style={{ marginBottom: "0.75rem" }}>
                  Scan the QR code with your authenticator app, then enter the 6-digit code below.
                </p>
                <div className="qr-wrap">
                  {QRCodeSVG ? (
                    <QRCodeSVG
                      value={totpSetup.provisioning_uri}
                      size={200}
                      level="M"
                      bgColor="#ffffff"
                      fgColor="#000000"
                    />
                  ) : (
                    <p className="qr-fallback">QR code loading…</p>
                  )}
                </div>
                <p className="form-hint" style={{ marginBottom: "0.75rem", wordBreak: "break-all" }}>
                  Or enter this secret manually: <code>{totpSetup.secret}</code>
                </p>
                <div className="form-group">
                  <label htmlFor="totp-verify">Verification code</label>
                  <input
                    id="totp-verify"
                    type="text"
                    value={totpVerifyCode}
                    onChange={(e) => setTotpVerifyCode(e.target.value)}
                    placeholder="000000"
                    maxLength={6}
                  />
                </div>
                <button type="submit" className="primary" disabled={loading}>Verify & enable</button>
              </form>
            )}
          </>
        )}

        {user?.totp_enabled && (
          <form onSubmit={disableTotp}>
            {!user?.is_google_user && (
              <div className="form-group">
                <label htmlFor="totp-disable-pw">Password (to disable TOTP)</label>
                <input
                  id="totp-disable-pw"
                  type="password"
                  value={totpDisablePassword}
                  onChange={(e) => setTotpDisablePassword(e.target.value)}
                  required
                />
              </div>
            )}
            {user?.is_google_user && (
              <p className="form-hint" style={{ marginBottom: "0.75rem" }}>
                You signed in with Google, so no password is required to disable 2FA.
              </p>
            )}
            <button type="submit" className="primary" disabled={loading || (!user?.is_google_user && !totpDisablePassword)}>Disable TOTP</button>
          </form>
        )}

        {message && (
          <p className={message.type === "error" ? "error-msg" : "success-msg"} style={{ marginTop: "0.75rem" }}>
            {message.text}
          </p>
        )}
      </div>

      <div className="profile-section-card" style={{ marginTop: "1.5rem" }}>
        <h2 className="profile-section-title">Phone & SMS verification</h2>
        <p className="profile-section-desc">
          SMS verification for login and destructive actions: <strong>{user?.sms_verification_enabled ? "enabled" : "disabled"}</strong>.
        </p>

        <div className="form-group" style={{ marginBottom: "1rem" }}>
          <label>Assigned phone number</label>
          <p style={{ margin: "0.35rem 0 0", display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
            <strong>{user?.phone || "—"}</strong>
            {user?.phone && (
              <span className="badge" style={{ fontSize: "0.75rem" }}>
                {user?.phone_verified ? "verified" : "not verified"}
              </span>
            )}
            {user?.phone && !editingPhone && (
              <button type="button" className="btn-sm" onClick={() => { setEditingPhone(true); setPhone(user.phone ?? ""); setPhoneStep("enter"); setMessage(null); }}>
                Edit
              </button>
            )}
            {editingPhone && (
              <button type="button" className="btn-sm secondary" onClick={() => { setEditingPhone(false); setPhoneStep("enter"); setPhone(user?.phone ?? ""); setPhoneChangePassword(""); setMessage(null); }}>
                Cancel
              </button>
            )}
          </p>
        </div>

        {(editingPhone && user?.phone_verified) || !user?.phone_verified ? (
          editingPhone && user?.phone_verified ? (
            <form onSubmit={phoneStep === "verify" ? verifyPhone : requestPhoneChange}>
              <div className="form-group">
                <label htmlFor="security-phone-change">New phone</label>
                <input
                  id="security-phone-change"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/[^\d+]/g, "").slice(0, 16))}
                  placeholder="+32xxx for country and phone format"
                  style={{ width: "100%", maxWidth: 280 }}
                  disabled={phoneStep === "verify"}
                />
              </div>
              {phoneStep === "enter" && (
                <div className="form-group">
                  <label htmlFor="security-phone-password">Your password (required to change verified phone)</label>
                  <input
                    id="security-phone-password"
                    type="password"
                    value={phoneChangePassword}
                    onChange={(e) => setPhoneChangePassword(e.target.value)}
                    placeholder="Enter password"
                    required
                  />
                </div>
              )}
              {phoneStep === "verify" && (
                <div className="form-group">
                  <label htmlFor="phone-verify-code">Verification code</label>
                  <input id="phone-verify-code" type="text" value={phoneVerifyCode} onChange={(e) => setPhoneVerifyCode(e.target.value.replace(/\D/g, "").slice(0, 8))} placeholder="0000" maxLength={8} inputMode="numeric" />
                </div>
              )}
              <button type="submit" className="primary" disabled={phoneSaving}>
                {phoneSaving ? (phoneStep === "verify" ? "Verifying…" : "Sending…") : phoneStep === "verify" ? "Verify & save" : "Send verification code"}
              </button>
              {phoneStep === "verify" && (
                <button type="button" className="secondary" style={{ marginLeft: "0.5rem" }} onClick={() => setPhoneStep("enter")}>
                  Back
                </button>
              )}
            </form>
          ) : !user?.phone_verified ? (
            <form onSubmit={phoneStep === "verify" ? verifyPhone : requestPhoneCode}>
              <div className="form-group">
                <label htmlFor="security-phone">Phone</label>
                <input
                  id="security-phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/[^\d+]/g, "").slice(0, 16))}
                  placeholder="+32xxx for country and phone format"
                  style={{ width: "100%", maxWidth: 280 }}
                  disabled={phoneStep === "verify"}
                />
              </div>
              {phoneStep === "verify" && (
                <div className="form-group">
                  <label htmlFor="phone-verify-code">Verification code</label>
                  <input id="phone-verify-code" type="text" value={phoneVerifyCode} onChange={(e) => setPhoneVerifyCode(e.target.value.replace(/\D/g, "").slice(0, 8))} placeholder="0000" maxLength={8} inputMode="numeric" />
                </div>
              )}
              <button type="submit" className="primary" disabled={phoneSaving}>
                {phoneSaving ? "Sending…" : phoneStep === "verify" ? "Verify & save" : "Send verification code"}
              </button>
              {phoneStep === "verify" && (
                <button type="button" className="secondary" style={{ marginLeft: "0.5rem" }} onClick={() => setPhoneStep("enter")}>
                  Back
                </button>
              )}
            </form>
          ) : null
        ) : null}

        {user?.phone_verified && (
          <div style={{ marginTop: "1rem" }}>
            {showSmsDisableConfirm ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  doToggleSmsVerification(false, smsDisablePassword);
                }}
                style={{ display: "flex", flexDirection: "column", gap: "0.75rem", maxWidth: 320 }}
              >
                <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>
                  {user?.is_google_user
                    ? "You signed in with Google. Click below to disable SMS verification."
                    : "Enter your password to disable SMS verification."}
                </p>
                {!user?.is_google_user && (
                  <div className="form-group" style={{ margin: 0 }}>
                    <label htmlFor="sms-disable-pw">Password</label>
                    <input
                      id="sms-disable-pw"
                      type="password"
                      value={smsDisablePassword}
                      onChange={(e) => setSmsDisablePassword(e.target.value)}
                      placeholder="Your password"
                      required
                    />
                  </div>
                )}
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button type="submit" className="primary" disabled={smsToggleLoading || (!user?.is_google_user && !smsDisablePassword)}>
                    {smsToggleLoading ? "Verifying…" : "Confirm & Disable"}
                  </button>
                  <button type="button" className="secondary" onClick={() => { setShowSmsDisableConfirm(false); setSmsDisablePassword(""); setMessage(null); }}>
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                <Toggle
                  id="sms-verification-toggle"
                  checked={user?.sms_verification_enabled ?? false}
                  onChange={toggleSmsVerification}
                  disabled={smsToggleLoading}
                />
                <label htmlFor="sms-verification-toggle" style={{ margin: 0 }}>
                  Require SMS code at login and for destructive actions (like 2FA)
                </label>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
