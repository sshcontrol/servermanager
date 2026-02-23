import { useState, useEffect } from "react";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../api/client";

type QRCodeProps = { value: string; size?: number; level?: string; bgColor?: string; fgColor?: string };

export default function ProfileSecurity() {
  const { user, refreshUser } = useAuth();
  const [QRCodeSVG, setQRCodeSVG] = useState<React.ComponentType<QRCodeProps> | null>(null);
  const [totpSetup, setTotpSetup] = useState<{ secret: string; provisioning_uri: string; qr_uri: string } | null>(null);
  const [totpVerifyCode, setTotpVerifyCode] = useState("");
  const [totpDisablePassword, setTotpDisablePassword] = useState("");
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    import("qrcode.react")
      .then((mod) => setQRCodeSVG(mod.QRCodeSVG as React.ComponentType<QRCodeProps>))
      .catch(() => setQRCodeSVG(null));
  }, []);

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
    if (!totpDisablePassword) return;
    setMessage(null);
    setLoading(true);
    try {
      await api.post("/api/auth/totp/disable", { password: totpDisablePassword });
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
            <button type="submit" className="primary" disabled={loading}>Disable TOTP</button>
          </form>
        )}

        {message && (
          <p className={message.type === "error" ? "error-msg" : "success-msg"} style={{ marginTop: "0.75rem" }}>
            {message.text}
          </p>
        )}
      </div>
    </div>
  );
}
