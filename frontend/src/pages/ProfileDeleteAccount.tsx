import { useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../api/client";
import Toggle from "../components/Toggle";

export default function ProfileDeleteAccount() {
  const { user } = useAuth();
  const isAdmin = user?.is_superuser || user?.roles?.some((r) => r.name === "admin");
  const hasTenant = !!user?.tenant_id;

  const [step, setStep] = useState<"consent" | "verify" | "sms" | "sent">("consent");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [smsCode, setSmsCode] = useState("");
  const [pendingSmsToken, setPendingSmsToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [consentChecked, setConsentChecked] = useState(false);

  const handleStart = () => {
    if (!consentChecked) {
      setError("Please confirm you understand and consent to close your account.");
      return;
    }
    setError("");
    setStep("verify");
  };

  const isGoogleUser = user?.is_google_user === true;
  const needsInitialPassword = user?.needs_initial_password === true;
  const skipPassword = isGoogleUser || needsInitialPassword;

  const handleRequestClosure = async () => {
    setError("");
    if (!skipPassword && !password.trim()) {
      setError("Password is required.");
      return;
    }
    setLoading(true);
    try {
      const body: Record<string, string | undefined> = {
        password: password,
        totp_code: user?.totp_enabled ? totpCode || undefined : undefined,
        sms_code: pendingSmsToken ? smsCode || undefined : undefined,
        pending_sms_token: pendingSmsToken || undefined,
      };
      const res = await api.post<{ requires_sms?: boolean; pending_token?: string; message?: string }>(
        "/api/auth/request-account-closure",
        body
      );
      if (res.requires_sms && res.pending_token) {
        setPendingSmsToken(res.pending_token);
        setStep("sms");
        setSmsCode("");
      } else {
        setStep("sent");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to request closure");
    } finally {
      setLoading(false);
    }
  };

  const handleSmsVerify = async () => {
    if (!pendingSmsToken || !smsCode.trim() || smsCode.length < 4) {
      setError("Enter the 4-digit code from your phone.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      await api.post("/api/auth/request-account-closure", {
        password,
        totp_code: user?.totp_enabled ? totpCode || undefined : undefined,
        sms_code: smsCode,
        pending_sms_token: pendingSmsToken,
      });
      setStep("sent");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verification failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="profile-section profile-delete-account">
      <div className="profile-section-card profile-delete-account-card">
        <h2 className="profile-section-title">Delete account</h2>
        <p className="profile-section-desc">
          Permanently close your account. This action cannot be undone.
        </p>

        {step === "consent" && (
          <>
            {isAdmin && hasTenant ? (
              <div className="profile-delete-warning">
                <p><strong>As an administrator, closing your account will:</strong></p>
                <ul>
                  <li>Remove all access to servers</li>
                  <li>Remove all users from your organization</li>
                  <li>No user will have access</li>
                  <li>Scripts will be removed from assigned servers</li>
                  <li>This cannot be restored</li>
                </ul>
                <p>By closing, you consent to permanently close your organization and all associated data.</p>
              </div>
            ) : (
              <div className="profile-delete-warning">
                <p>By closing your account, you consent to permanently delete it. You will lose access to all servers and data.</p>
              </div>
            )}
            <label style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginTop: "1rem", cursor: "pointer" }}>
              <Toggle checked={consentChecked} onChange={setConsentChecked} />
              <span>I understand and consent to close my account. This cannot be undone.</span>
            </label>
            {error && <p className="error-msg" style={{ marginTop: "0.75rem" }}>{error}</p>}
            <button
              type="button"
              className="btn-outline-danger"
              style={{ marginTop: "1rem" }}
              onClick={handleStart}
              disabled={!consentChecked}
            >
              Continue to close account
            </button>
          </>
        )}

        {step === "verify" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleRequestClosure();
            }}
            style={{ display: "flex", flexDirection: "column", gap: "1rem" }}
          >
            <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>
              Verify your identity to continue.
              {!skipPassword && " Enter your password."}
              {user?.totp_enabled && " Enter 2FA code."}
            </p>
            {!skipPassword && (
              <div className="form-group">
                <label htmlFor="closure-password">Password</label>
                <input
                  id="closure-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
              </div>
            )}
            {user?.totp_enabled && (
              <div className="form-group">
                <label htmlFor="closure-totp">2FA code</label>
                <input
                  id="closure-totp"
                  type="text"
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="000000"
                  maxLength={6}
                  inputMode="numeric"
                />
              </div>
            )}
            {error && <p className="error-msg">{error}</p>}
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <button type="button" className="btn-outline" onClick={() => setStep("consent")}>
                Back
              </button>
              <button type="submit" className="btn-outline-danger" disabled={loading}>
                {loading ? "Sending…" : "Send confirmation link"}
              </button>
            </div>
          </form>
        )}

        {step === "sms" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSmsVerify();
            }}
            style={{ display: "flex", flexDirection: "column", gap: "1rem" }}
          >
            <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>
              Enter the 4-digit code sent to your phone.
            </p>
            <div className="form-group">
              <label htmlFor="closure-sms">SMS code</label>
              <input
                id="closure-sms"
                type="text"
                value={smsCode}
                onChange={(e) => setSmsCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
                placeholder="0000"
                maxLength={8}
                inputMode="numeric"
              />
            </div>
            {error && <p className="error-msg">{error}</p>}
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <button type="button" className="btn-outline" onClick={() => setStep("verify")}>
                Back
              </button>
              <button type="submit" className="btn-outline-danger" disabled={loading || smsCode.length < 4}>
                {loading ? "Verifying…" : "Verify & send link"}
              </button>
            </div>
          </form>
        )}

        {step === "sent" && (
          <div className="profile-delete-sent">
            <p style={{ color: "var(--text-secondary)", marginBottom: "1rem" }}>
              A confirmation link has been sent to your email. Click the link to permanently close your account.
            </p>
            <p style={{ fontSize: "0.9rem", color: "var(--text-muted)" }}>
              The link expires in 24 hours. If you did not request this, please secure your account.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
