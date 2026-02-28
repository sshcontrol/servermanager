import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";

type SmppSettingsData = {
  link: string;
  username: string;
  password_masked: string;
  sender_name: string;
  enabled: boolean;
};

type SmppCallbackItem = {
  id: string;
  callback_type: string;
  message_id: string | null;
  status: string | null;
  raw_payload: string | null;
  created_at: string;
};

const DEFAULT_SMS_LINK = "http://65.108.18.8:2775";
const DEFAULT_SMS_USERNAME = "ssh-cont1";
const DEFAULT_SMS_PASSWORD = "1ksKtAQ1";

export default function SuperadminSms() {
  const [tab, setTab] = useState<"settings" | "callbacks">("settings");

  // Settings state
  const [settings, setSettings] = useState<SmppSettingsData | null>(null);
  const [link, setLink] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [senderName, setSenderName] = useState("SSHCONTROL");
  const [enabled, setEnabled] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsMsg, setSettingsMsg] = useState("");
  const [settingsError, setSettingsError] = useState("");
  const [testPhone, setTestPhone] = useState("");
  const [testingSms, setTestingSms] = useState(false);
  const [testSmsMsg, setTestSmsMsg] = useState("");

  // Callbacks state
  const [callbacks, setCallbacks] = useState<SmppCallbackItem[]>([]);
  const [callbacksTotal, setCallbacksTotal] = useState(0);
  const [callbacksPage, setCallbacksPage] = useState(1);
  const [callbacksLoading, setCallbacksLoading] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [testCallbackMsg, setTestCallbackMsg] = useState("");
  const [testCallbackLoading, setTestCallbackLoading] = useState(false);

  const fetchSettings = async () => {
    try {
      const res = await api.get<SmppSettingsData>("/api/superadmin/sms/settings");
      setSettings(res);
      const hasConfig = !!(res.link?.trim() || res.username?.trim());
      setLink(res.link?.trim() || DEFAULT_SMS_LINK);
      setUsername(res.username?.trim() || DEFAULT_SMS_USERNAME);
      setPassword(hasConfig ? "" : DEFAULT_SMS_PASSWORD);
      setSenderName(res.sender_name?.trim() || "SSHCONTROL");
      setEnabled(hasConfig ? res.enabled : true);
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : "Failed to load");
      setLink(DEFAULT_SMS_LINK);
      setUsername(DEFAULT_SMS_USERNAME);
      setPassword(DEFAULT_SMS_PASSWORD);
      setEnabled(true);
    }
  };

  const useDefaults = () => {
    setLink(DEFAULT_SMS_LINK);
    setUsername(DEFAULT_SMS_USERNAME);
    setPassword(DEFAULT_SMS_PASSWORD);
    setSenderName("SSHCONTROL");
    setEnabled(true);
    setSettingsMsg("");
    setSettingsError("");
  };

  const handleTestSms = async () => {
    const phone = testPhone.trim().replace(/\D/g, "");
    if (!phone || phone.length < 10) {
      setTestSmsMsg("Enter a valid phone number (E.164, e.g. +1234567890)");
      return;
    }
    setTestSmsMsg("");
    setTestingSms(true);
    try {
      const res = await api.post<{ message: string }>("/api/superadmin/sms/test", {
        to_phone: phone.startsWith("+") ? phone : `+${phone}`,
      });
      setTestSmsMsg(res.message || "Test SMS sent.");
    } catch (e) {
      setTestSmsMsg(e instanceof Error ? e.message : "Failed to send test SMS");
    } finally {
      setTestingSms(false);
    }
  };

  const fetchCallbacks = async () => {
    setCallbacksLoading(true);
    try {
      const res = await api.get<{ callbacks: SmppCallbackItem[]; total: number }>(
        `/api/superadmin/sms/callbacks?page=${callbacksPage}&page_size=50`
      );
      setCallbacks(res.callbacks);
      setCallbacksTotal(res.total);
    } catch {
      setCallbacks([]);
    } finally {
      setCallbacksLoading(false);
    }
  };

  const fetchWebhookUrl = async () => {
    try {
      const res = await api.get<{ webhook_url: string }>("/api/superadmin/sms/webhook-url");
      setWebhookUrl(res.webhook_url || "");
    } catch {
      const apiBase = import.meta.env.VITE_API_URL || "";
      setWebhookUrl(
        apiBase
          ? `${apiBase.replace(/\/$/, "")}/api/webhooks/smpp`
          : `${window.location.origin}/api/webhooks/smpp`
      );
    }
  };

  const handleTestCallback = async () => {
    setTestCallbackMsg("");
    setTestCallbackLoading(true);
    try {
      const res = await api.post<{ message: string }>("/api/superadmin/sms/test-callback");
      setTestCallbackMsg(res.message || "Test callback created.");
      fetchCallbacks();
    } catch (e) {
      setTestCallbackMsg(e instanceof Error ? e.message : "Failed to create test callback");
    } finally {
      setTestCallbackLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  useEffect(() => {
    if (tab === "settings") fetchWebhookUrl();
  }, [tab]);

  useEffect(() => {
    if (tab === "callbacks") fetchCallbacks();
  }, [tab, callbacksPage]);

  const saveSettings = async () => {
    setSavingSettings(true);
    setSettingsMsg("");
    setSettingsError("");
    try {
      const payload: Record<string, unknown> = {
        link,
        username,
        sender_name: senderName,
        enabled,
      };
      if (password) payload.password = password;
      const res = await api.patch<SmppSettingsData>("/api/superadmin/sms/settings", payload);
      setSettings(res);
      setPassword("");
      setSettingsMsg("Settings saved successfully");
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSavingSettings(false);
    }
  };

  const tabBtn = (t: "settings" | "callbacks", label: string) => (
    <button
      className={tab === t ? "primary" : "secondary"}
      onClick={() => setTab(t)}
      style={{ flex: 1 }}
    >
      {label}
    </button>
  );

  const displayWebhookUrl =
    webhookUrl ||
    (import.meta.env.VITE_API_URL
      ? `${String(import.meta.env.VITE_API_URL).replace(/\/$/, "")}/api/webhooks/smpp`
      : `${window.location.origin}/api/webhooks/smpp`);

  return (
    <div>
      <div className="page-header">
        <h1>SMS Integration (SMPP)</h1>
      </div>

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.5rem" }}>
        {tabBtn("settings", "SMPP Settings")}
        {tabBtn("callbacks", "Callbacks")}
      </div>

      {/* ─── Settings Tab ─────────────────────────────────────────── */}
      {tab === "settings" && (
        <div className="card" style={{ maxWidth: 600 }}>
          <h3 style={{ margin: "0 0 0.25rem", color: "var(--text-primary)" }}>SMPP Configuration</h3>
          <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginBottom: "1.5rem" }}>
            Configure your SMPP gateway credentials for sending SMS. The callback URL below receives delivery reports and other events from your provider.
          </p>

          <div className="form-group">
            <label>Callback URL (for delivery reports)</label>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <input
                type="text"
                value={displayWebhookUrl}
                readOnly
                style={{ flex: 1, background: "rgba(255,255,255,0.04)", color: "var(--text-muted)" }}
              />
              <button
                className="secondary"
                onClick={() => navigator.clipboard.writeText(displayWebhookUrl)}
              >
                Copy
              </button>
            </div>
            <p style={{ color: "var(--text-muted)", fontSize: "0.8rem", margin: "0.25rem 0 0" }}>
              Configure this URL in your SMPP provider dashboard for webhook/delivery report callbacks.
              Ensure PUBLIC_API_URL in backend .env matches your public API URL so this is reachable.
            </p>
          </div>

          <div className="form-group">
            <label>Link (SMPP gateway URL)</label>
            <input
              type="url"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="65.108.18.8:2775 or host:2775 (SMPP host:port)"
            />
            <p style={{ color: "var(--text-muted)", fontSize: "0.8rem", margin: "0.25rem 0 0" }}>
              Full API endpoint. If your gateway uses a specific path (e.g. /api/sms/send), include it.
            </p>
          </div>

          <div className="form-group">
            <label>Sender name</label>
            <input
              type="text"
              value={senderName}
              onChange={(e) => setSenderName(e.target.value)}
              placeholder="SSHCONTROL"
              maxLength={50}
            />
            <p style={{ color: "var(--text-muted)", fontSize: "0.8rem", margin: "0.25rem 0 0" }}>
              Shown as the sender for SMS (default: SSHCONTROL).
            </p>
          </div>

          <div className="form-group">
            <label>Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="SMPP username"
              autoComplete="off"
            />
          </div>

          <div className="form-group">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={settings?.password_masked || "••••••••"}
              autoComplete="off"
            />
            {settings?.password_masked && (
              <p style={{ color: "var(--text-muted)", fontSize: "0.8rem", margin: "0.25rem 0 0" }}>
                Current: {settings.password_masked}
              </p>
            )}
          </div>

          <div className="form-group" style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              style={{ width: "auto", accentColor: "var(--accent)" }}
              id="sms-enabled"
            />
            <label htmlFor="sms-enabled" style={{ margin: 0 }}>
              Enable SMS sending
            </label>
          </div>

          {settingsMsg && <p style={{ color: "var(--accent)", margin: "0.75rem 0" }}>{settingsMsg}</p>}
          {settingsError && <p className="error-msg" style={{ margin: "0.75rem 0" }}>{settingsError}</p>}

          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button className="primary" onClick={saveSettings} disabled={savingSettings}>
              {savingSettings ? "Saving..." : "Save Settings"}
            </button>
            <button className="secondary" onClick={useDefaults} type="button">
              Use defaults
            </button>
          </div>

          <div style={{ marginTop: "2rem", paddingTop: "1.5rem", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
            <h4 style={{ color: "var(--text-primary)", margin: "0 0 0.75rem" }}>Send Test SMS</h4>
            <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", margin: "0 0 0.75rem" }}>
              Verify the SMPP gateway connection. Enter a phone number in E.164 format (e.g. +1234567890).
            </p>
            <div style={{ display: "flex", gap: "0.75rem", alignItems: "flex-end" }}>
              <div className="form-group" style={{ flex: 1, margin: 0 }}>
                <label>Phone number</label>
                <input
                  type="tel"
                  value={testPhone}
                  onChange={(e) => setTestPhone(e.target.value)}
                  placeholder="+1234567890"
                />
              </div>
              <button
                className="primary"
                onClick={handleTestSms}
                disabled={testingSms || !testPhone.trim()}
                style={{ height: 40, whiteSpace: "nowrap" }}
              >
                {testingSms ? "Sending..." : "Send Test SMS"}
              </button>
            </div>
            {testSmsMsg && (
              <p style={{ color: testSmsMsg.includes("sent") ? "var(--accent)" : "#ef4444", marginTop: "0.5rem", fontSize: "0.9rem" }}>
                {testSmsMsg}
                {testSmsMsg.includes("403") && !testSmsMsg.includes("whitelist") && (
                  <span style={{ display: "block", marginTop: "0.5rem", color: "var(--text-muted)", fontSize: "0.85rem" }}>
                    HTTP 403 often means IP not whitelisted. Ensure the backend runs on a whitelisted IP (or set SMPP_PROXY).
                  </span>
                )}
              </p>
            )}
          </div>
        </div>
      )}

      {/* ─── Callbacks Tab ─────────────────────────────────────────── */}
      {tab === "callbacks" && (
        <div className="card">
          <h3 style={{ margin: "0 0 0.5rem", color: "var(--text-primary)" }}>SMPP Callbacks</h3>
          <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginBottom: "0.5rem" }}>
            Incoming delivery reports and other callbacks from your SMPP provider. Most recent first.
          </p>
          <p style={{ color: "var(--text-muted)", fontSize: "0.8rem", marginBottom: "1rem" }}>
            If no callbacks appear after sending SMS, your SMPP gateway may not support HTTP webhooks.
            Use &quot;Create test callback&quot; to verify the tab works. Ensure the callback URL is configured in your provider dashboard and PUBLIC_API_URL is correct.
          </p>

          <div style={{ marginBottom: "1rem", display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <button
              className="secondary"
              onClick={handleTestCallback}
              disabled={testCallbackLoading}
            >
              {testCallbackLoading ? "Creating..." : "Create test callback"}
            </button>
            {testCallbackMsg && (
              <span style={{ color: "var(--accent)", fontSize: "0.9rem" }}>{testCallbackMsg}</span>
            )}
          </div>

          {callbacksLoading ? (
            <p style={{ color: "var(--text-muted)" }}>Loading...</p>
          ) : callbacks.length === 0 ? (
            <p style={{ color: "var(--text-muted)" }}>No callbacks recorded yet.</p>
          ) : (
            <>
              <div style={{ overflowX: "auto" }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Type</th>
                      <th>Message ID</th>
                      <th>Status</th>
                      <th>Payload</th>
                    </tr>
                  </thead>
                  <tbody>
                    {callbacks.map((c) => (
                      <tr key={c.id}>
                        <td style={{ whiteSpace: "nowrap", fontSize: "0.85rem" }}>
                          {new Date(c.created_at).toLocaleString()}
                        </td>
                        <td><code>{c.callback_type || "—"}</code></td>
                        <td style={{ maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis" }}>
                          {c.message_id || "—"}
                        </td>
                        <td>{c.status || "—"}</td>
                        <td style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", fontSize: "0.8rem" }}>
                          {c.raw_payload ? (
                            <details>
                              <summary>View</summary>
                              <pre style={{ margin: "0.5rem 0", fontSize: "0.75rem", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                                {c.raw_payload}
                              </pre>
                            </details>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {callbacksTotal > 50 && (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "1rem" }}>
                  <span style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>
                    {callbacksTotal} total
                  </span>
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <button
                      className="secondary"
                      onClick={() => setCallbacksPage((p) => Math.max(1, p - 1))}
                      disabled={callbacksPage <= 1}
                    >
                      Previous
                    </button>
                    <button
                      className="secondary"
                      onClick={() => setCallbacksPage((p) => p + 1)}
                      disabled={callbacksPage * 50 >= callbacksTotal}
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      <p style={{ marginTop: "1.5rem" }}>
        <Link to="/superadmin/tenants" className="btn-link">← Superadmin</Link>
      </p>
    </div>
  );
}
