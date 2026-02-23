import { useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../contexts/AuthContext";

export type DestructiveAction = "delete_server" | "delete_user" | "delete_server_group" | "delete_user_group";

type Props = {
  open: boolean;
  title: string;
  message: string;
  action: DestructiveAction;
  targetId: string;
  targetName: string;
  onVerified: (verificationToken: string) => void;
  onCancel: () => void;
};

type VerificationMethod = "email" | "totp" | "sms";

export default function DestructiveVerificationModal({
  open,
  title,
  message,
  action,
  targetId,
  targetName,
  onVerified,
  onCancel,
}: Props) {
  const { user } = useAuth();
  const totpEnabled = user?.totp_enabled === true;

  const [method, setMethod] = useState<VerificationMethod | null>(null);
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState("");

  const handleSendCode = async () => {
    setError("");
    setSending(true);
    try {
      await api.post("/api/auth/request-destructive-verification", {
        action,
        target_id: targetId,
        target_name: targetName,
      });
      setMethod("email");
      setCode("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send code");
    } finally {
      setSending(false);
    }
  };

  const handleVerify = async () => {
    if (!method || !code.trim()) return;
    setError("");
    setVerifying(true);
    try {
      const res = await api.post<{ verification_token: string }>("/api/auth/verify-destructive-action", {
        verification_type: method,
        code: code.trim(),
        action,
        target_id: targetId,
      });
      onVerified(res.verification_token);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verification failed");
    } finally {
      setVerifying(false);
    }
  };

  const handleChooseTotp = () => {
    setMethod("totp");
    setCode("");
    setError("");
  };

  const handleChooseSms = () => {
    setError("SMS verification will be available soon.");
  };

  if (!open) return null;

  const codeLength = method === "totp" ? 6 : 4;

  return (
    <div className="confirm-overlay" onClick={onCancel} role="dialog" aria-modal="true" aria-label={title}>
      <div className="confirm-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <div className="confirm-title" style={{ color: "var(--danger, #ef4444)" }}>{title}</div>
        <div className="confirm-message" style={{ marginBottom: "1rem" }}>{message}</div>

        <p style={{ fontSize: "0.9rem", color: "var(--text-muted)", marginBottom: "0.75rem" }}>
          Verify your identity to continue:
        </p>

        {!method ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            <button
              type="button"
              className="primary"
              disabled={sending}
              onClick={handleSendCode}
            >
              {sending ? "Sending…" : "Verify by Email (4-digit code)"}
            </button>
            {totpEnabled && (
              <button
                type="button"
                className="btn-outline"
                onClick={handleChooseTotp}
              >
                Verify by 2FA (authenticator app)
              </button>
            )}
            <button
              type="button"
              className="btn-outline"
              disabled
              onClick={handleChooseSms}
              title="Coming soon"
            >
              Verify by SMS <span style={{ fontSize: "0.75rem", opacity: 0.7 }}>(coming soon)</span>
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <div>
              <label style={{ display: "block", fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "0.25rem" }}>
                {method === "totp" ? "Enter 6-digit code from your authenticator app" : "Enter 4-digit code from your email"}
              </label>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={codeLength}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                placeholder={method === "totp" ? "000000" : "0000"}
                style={{
                  width: "100%",
                  textAlign: "center",
                  fontSize: "1.25rem",
                  letterSpacing: "0.3em",
                  padding: "0.5rem",
                }}
                autoFocus
              />
            </div>
            {error && <p className="error-msg" style={{ margin: 0, fontSize: "0.85rem" }}>{error}</p>}
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn-outline"
                onClick={() => { setMethod(null); setCode(""); setError(""); }}
              >
                Back
              </button>
              <button
                type="button"
                className="btn-outline-danger"
                disabled={verifying || code.length !== codeLength}
                onClick={handleVerify}
              >
                {verifying ? "Verifying…" : "Verify & Delete"}
              </button>
            </div>
          </div>
        )}

        <div style={{ marginTop: "1rem" }}>
          <button type="button" className="btn-outline" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
