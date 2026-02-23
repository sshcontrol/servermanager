import { useState, useEffect } from "react";
import { api } from "../api/client";

type EmailSettingsData = {
  sendgrid_api_key_masked: string;
  from_email: string;
  from_name: string;
  enabled: boolean;
};

type EmailTemplateData = {
  id: string;
  template_key: string;
  display_name: string;
  subject: string;
  body_html: string;
};

const PLACEHOLDER_HELP: Record<string, string> = {
  verify_email: "{{full_name}}, {{action_url}}, {{expires_hours}}",
  password_reset: "{{full_name}}, {{action_url}}, {{expires_hours}}",
  welcome: "{{full_name}}, {{action_url}}",
};

export default function SuperadminEmail() {
  const [tab, setTab] = useState<"settings" | "templates">("settings");

  // Settings state
  const [settings, setSettings] = useState<EmailSettingsData | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [fromName, setFromName] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsMsg, setSettingsMsg] = useState("");
  const [settingsError, setSettingsError] = useState("");

  // Test email
  const [testEmail, setTestEmail] = useState("");
  const [testingEmail, setTestingEmail] = useState(false);
  const [testMsg, setTestMsg] = useState("");

  // Templates state
  const [templates, setTemplates] = useState<EmailTemplateData[]>([]);
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editSubject, setEditSubject] = useState("");
  const [editBody, setEditBody] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateMsg, setTemplateMsg] = useState("");
  const [previewHtml, setPreviewHtml] = useState("");
  const [showPreview, setShowPreview] = useState(false);

  const fetchSettings = async () => {
    try {
      const res = await api.get<EmailSettingsData>("/api/superadmin/email/settings");
      setSettings(res);
      setFromEmail(res.from_email);
      setFromName(res.from_name);
      setEnabled(res.enabled);
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : "Failed to load");
    }
  };

  const fetchTemplates = async () => {
    try {
      const res = await api.get<EmailTemplateData[]>("/api/superadmin/email/templates");
      setTemplates(res);
    } catch {}
  };

  useEffect(() => {
    fetchSettings();
    fetchTemplates();
  }, []);

  const saveSettings = async () => {
    setSavingSettings(true);
    setSettingsMsg("");
    setSettingsError("");
    try {
      const payload: Record<string, unknown> = {
        from_email: fromEmail,
        from_name: fromName,
        enabled,
      };
      if (apiKey) payload.sendgrid_api_key = apiKey;
      const res = await api.patch<EmailSettingsData>("/api/superadmin/email/settings", payload);
      setSettings(res);
      setApiKey("");
      setSettingsMsg("Settings saved successfully");
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSavingSettings(false);
    }
  };

  const handleTestEmail = async () => {
    if (!testEmail) return;
    setTestingEmail(true);
    setTestMsg("");
    try {
      const res = await api.post<{ message: string }>("/api/superadmin/email/test", { to_email: testEmail });
      setTestMsg(res.message);
    } catch (err) {
      setTestMsg(err instanceof Error ? err.message : "Test failed");
    } finally {
      setTestingEmail(false);
    }
  };

  const openTemplate = (t: EmailTemplateData) => {
    setEditKey(t.template_key);
    setEditSubject(t.subject);
    setEditBody(t.body_html);
    setTemplateMsg("");
    setShowPreview(false);
  };

  const saveTemplate = async () => {
    if (!editKey) return;
    setSavingTemplate(true);
    setTemplateMsg("");
    try {
      await api.patch(`/api/superadmin/email/templates/${editKey}`, {
        subject: editSubject,
        body_html: editBody,
      });
      setTemplateMsg("Template saved");
      await fetchTemplates();
    } catch (err) {
      setTemplateMsg(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSavingTemplate(false);
    }
  };

  const renderPreview = () => {
    let html = editBody;
    html = html.replace(/\{\{full_name\}\}/g, "John Doe");
    html = html.replace(/\{\{action_url\}\}/g, "https://sshcontrol.com/example-link");
    html = html.replace(/\{\{expires_hours\}\}/g, "48");
    html = html.replace(/\{\{company_name\}\}/g, "Acme Corp");
    setPreviewHtml(html);
    setShowPreview(true);
  };

  const tabBtn = (t: "settings" | "templates", label: string) => (
    <button
      className={tab === t ? "primary" : "secondary"}
      onClick={() => setTab(t)}
      style={{ flex: 1 }}
    >
      {label}
    </button>
  );

  return (
    <div>
      <div className="page-header">
        <h1>Email Configuration</h1>
      </div>

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.5rem" }}>
        {tabBtn("settings", "SendGrid Integration")}
        {tabBtn("templates", "Email Templates")}
      </div>

      {/* ─── Settings Tab ─────────────────────────────────────────── */}
      {tab === "settings" && (
        <div className="card" style={{ maxWidth: 600 }}>
          <h3 style={{ margin: "0 0 0.25rem", color: "var(--text-primary)" }}>SendGrid API Settings</h3>
          <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginBottom: "1.5rem" }}>
            Configure your Twilio SendGrid Web API credentials. Emails will be sent using the official Python SDK.
          </p>

          <div className="form-group">
            <label>SendGrid API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={settings?.sendgrid_api_key_masked || "SG.xxxxx..."}
              autoComplete="off"
            />
            {settings?.sendgrid_api_key_masked && (
              <p style={{ color: "var(--text-muted)", fontSize: "0.8rem", margin: "0.25rem 0 0" }}>
                Current: {settings.sendgrid_api_key_masked}
              </p>
            )}
          </div>

          <div className="form-group">
            <label>From Email</label>
            <input
              type="email"
              value={fromEmail}
              onChange={(e) => setFromEmail(e.target.value)}
              placeholder="noreply@sshcontrol.com"
            />
          </div>

          <div className="form-group">
            <label>From Name</label>
            <input
              value={fromName}
              onChange={(e) => setFromName(e.target.value)}
              placeholder="SSHCONTROL"
            />
          </div>

          <div className="form-group" style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              style={{ width: "auto", accentColor: "var(--accent)" }}
              id="email-enabled"
            />
            <label htmlFor="email-enabled" style={{ margin: 0 }}>
              Enable email sending
            </label>
          </div>

          {settingsMsg && <p style={{ color: "var(--accent)", margin: "0.75rem 0" }}>{settingsMsg}</p>}
          {settingsError && <p className="error-msg" style={{ margin: "0.75rem 0" }}>{settingsError}</p>}

          <button className="primary" onClick={saveSettings} disabled={savingSettings} style={{ marginRight: "1rem" }}>
            {savingSettings ? "Saving..." : "Save Settings"}
          </button>

          {/* Test email section */}
          <div style={{ marginTop: "2rem", paddingTop: "1.5rem", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
            <h4 style={{ color: "var(--text-primary)", margin: "0 0 0.75rem" }}>Send Test Email</h4>
            <div style={{ display: "flex", gap: "0.75rem", alignItems: "flex-end" }}>
              <div className="form-group" style={{ flex: 1, margin: 0 }}>
                <label>Recipient</label>
                <input
                  type="email"
                  value={testEmail}
                  onChange={(e) => setTestEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </div>
              <button
                className="primary"
                onClick={handleTestEmail}
                disabled={testingEmail || !testEmail}
                style={{ height: 40, whiteSpace: "nowrap" }}
              >
                {testingEmail ? "Sending..." : "Send Test"}
              </button>
            </div>
            {testMsg && (
              <p style={{ color: testMsg.includes("sent") ? "var(--accent)" : "#ef4444", marginTop: "0.5rem", fontSize: "0.9rem" }}>
                {testMsg}
              </p>
            )}
          </div>
        </div>
      )}

      {/* ─── Templates Tab ────────────────────────────────────────── */}
      {tab === "templates" && (
        <div style={{ display: "grid", gridTemplateColumns: editKey ? "280px 1fr" : "1fr", gap: "1.25rem" }}>
          {/* Template list */}
          <div>
            {templates.map((t) => (
              <div
                key={t.template_key}
                className="card"
                onClick={() => openTemplate(t)}
                style={{
                  cursor: "pointer",
                  marginBottom: "0.75rem",
                  border: editKey === t.template_key ? "1px solid var(--accent)" : undefined,
                  transition: "border-color 0.15s",
                }}
              >
                <h4 style={{ margin: "0 0 0.25rem", color: "var(--text-primary)" }}>{t.display_name}</h4>
                <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "0.8rem" }}>
                  Key: <code>{t.template_key}</code>
                </p>
                <p style={{ margin: "0.25rem 0 0", color: "var(--text-muted)", fontSize: "0.85rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  Subject: {t.subject}
                </p>
              </div>
            ))}
            {templates.length === 0 && (
              <p style={{ color: "var(--text-muted)" }}>No templates found. Run database migration to seed defaults.</p>
            )}
          </div>

          {/* Template editor */}
          {editKey && (
            <div className="card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                <h3 style={{ margin: 0, color: "var(--text-primary)" }}>
                  Edit: {templates.find((t) => t.template_key === editKey)?.display_name}
                </h3>
                <button className="btn-sm" onClick={() => setEditKey(null)}>Close</button>
              </div>

              <div style={{ background: "rgba(45,212,191,0.06)", border: "1px solid rgba(45,212,191,0.15)", borderRadius: 8, padding: "0.75rem", marginBottom: "1rem", fontSize: "0.8rem", color: "var(--text-muted)" }}>
                Available placeholders: <code style={{ color: "var(--accent)" }}>{PLACEHOLDER_HELP[editKey] || "{{full_name}}, {{action_url}}"}</code>
              </div>

              <div className="form-group">
                <label>Subject Line</label>
                <input
                  value={editSubject}
                  onChange={(e) => setEditSubject(e.target.value)}
                  placeholder="Email subject..."
                />
              </div>

              <div className="form-group">
                <label>HTML Body</label>
                <textarea
                  value={editBody}
                  onChange={(e) => setEditBody(e.target.value)}
                  rows={18}
                  style={{ fontFamily: "monospace", fontSize: "0.8rem", lineHeight: 1.5 }}
                />
              </div>

              {templateMsg && (
                <p style={{ color: templateMsg.includes("saved") ? "var(--accent)" : "#ef4444", marginBottom: "0.75rem", fontSize: "0.9rem" }}>
                  {templateMsg}
                </p>
              )}

              <div style={{ display: "flex", gap: "0.75rem" }}>
                <button className="primary" onClick={saveTemplate} disabled={savingTemplate}>
                  {savingTemplate ? "Saving..." : "Save Template"}
                </button>
                <button className="secondary" onClick={renderPreview}>
                  Preview
                </button>
              </div>

              {/* Preview modal */}
              {showPreview && (
                <div style={{ marginTop: "1.5rem", borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: "1.5rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
                    <h4 style={{ margin: 0, color: "var(--text-primary)" }}>Preview</h4>
                    <button className="btn-sm" onClick={() => setShowPreview(false)}>Hide</button>
                  </div>
                  <div style={{ background: "#fff", borderRadius: 8, padding: "1rem", maxHeight: 400, overflow: "auto" }}>
                    <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
