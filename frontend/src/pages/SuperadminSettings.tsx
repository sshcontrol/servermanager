import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";

type PlatformSettingsData = {
  google_analytics_id: string;
  google_ads_id: string;
  google_ads_conversion_label: string;
  google_tag_manager_id: string;
  google_oauth_client_id: string;
  google_oauth_client_secret_masked: string;
  recaptcha_site_key: string;
  recaptcha_secret_key_masked: string;
  seo_site_title: string;
  seo_meta_description: string | null;
  seo_keywords: string;
  seo_og_image_url: string;
};

type TabId = "analytics" | "ads" | "oauth" | "recaptcha" | "seo";

export default function SuperadminSettings() {
  const [tab, setTab] = useState<TabId>("analytics");
  const [settings, setSettings] = useState<PlatformSettingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);

  // Form state
  const [gaId, setGaId] = useState("");
  const [gtmId, setGtmId] = useState("");
  const [adsId, setAdsId] = useState("");
  const [adsLabel, setAdsLabel] = useState("");
  const [oauthClientId, setOauthClientId] = useState("");
  const [oauthClientSecret, setOauthClientSecret] = useState("");
  const [recaptchaSiteKey, setRecaptchaSiteKey] = useState("");
  const [recaptchaSecretKey, setRecaptchaSecretKey] = useState("");
  const [seoTitle, setSeoTitle] = useState("");
  const [seoDesc, setSeoDesc] = useState("");
  const [seoKeywords, setSeoKeywords] = useState("");
  const [seoOgImage, setSeoOgImage] = useState("");

  const fetchSettings = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.get<PlatformSettingsData>("/api/superadmin/settings");
      setSettings(res);
      setGaId(res.google_analytics_id);
      setGtmId(res.google_tag_manager_id);
      setAdsId(res.google_ads_id);
      setAdsLabel(res.google_ads_conversion_label);
      setOauthClientId(res.google_oauth_client_id);
      setRecaptchaSiteKey(res.recaptcha_site_key || "");
      setSeoTitle(res.seo_site_title);
      setSeoDesc(res.seo_meta_description || "");
      setSeoKeywords(res.seo_keywords);
      setSeoOgImage(res.seo_og_image_url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const saveSettings = async () => {
    setSaving(true);
    setMsg("");
    setError("");
    try {
      const payload: Record<string, unknown> = {
        google_analytics_id: gaId.trim(),
        google_tag_manager_id: gtmId.trim(),
        google_ads_id: adsId.trim(),
        google_ads_conversion_label: adsLabel.trim(),
        google_oauth_client_id: oauthClientId.trim(),
        recaptcha_site_key: recaptchaSiteKey.trim(),
        seo_site_title: seoTitle.trim() || "SSHCONTROL",
        seo_meta_description: seoDesc.trim() || null,
        seo_keywords: seoKeywords.trim(),
        seo_og_image_url: seoOgImage.trim(),
      };
      if (oauthClientSecret) payload.google_oauth_client_secret = oauthClientSecret;
      if (recaptchaSecretKey) payload.recaptcha_secret_key = recaptchaSecretKey;
      await api.patch<PlatformSettingsData>("/api/superadmin/settings", payload);
      setMsg("Settings saved successfully");
      setOauthClientSecret("");
      setRecaptchaSecretKey("");
      await fetchSettings();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const tabBtn = (t: TabId, label: string) => (
    <button
      key={t}
      className={tab === t ? "primary" : "secondary"}
      onClick={() => setTab(t)}
      style={{ flex: 1 }}
    >
      {label}
    </button>
  );

  if (loading) {
    return (
      <div className="container app-page">
        <div className="page-header">
          <Link to="/superadmin/tenants" className="btn-link">← Superadmin</Link>
          <h1 style={{ marginTop: "0.5rem" }}>Platform Settings</h1>
        </div>
        <p style={{ color: "var(--text-muted)" }}>Loading...</p>
      </div>
    );
  }

  return (
    <div className="container app-page">
      <div className="page-header">
        <Link to="/superadmin/tenants" className="btn-link">← Superadmin</Link>
        <h1 style={{ marginTop: "0.5rem" }}>Platform Settings</h1>
        <p style={{ color: "var(--text-muted)", fontSize: "0.95rem", marginTop: "0.25rem" }}>
          Google Analytics, Ads, OAuth, and SEO for search engines
        </p>
      </div>

      <div className="page-actions" style={{ marginBottom: "1.5rem" }}>
        {tabBtn("analytics", "Google Analytics")}
        {tabBtn("ads", "Google Ads")}
        {tabBtn("oauth", "Google OAuth")}
        {tabBtn("recaptcha", "reCAPTCHA")}
        {tabBtn("seo", "SEO & Keywords")}
      </div>

      {msg && <p style={{ color: "var(--accent)", marginBottom: "1rem" }}>{msg}</p>}
      {error && <p className="error-msg" style={{ marginBottom: "1rem" }}>{error}</p>}

      {/* ─── Google Analytics ───────────────────────────────────── */}
      {tab === "analytics" && (
        <div className="card card-form">
          <h2 className="card-subtitle">Google Analytics 4</h2>
          <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginBottom: "1.5rem" }}>
            Add your GA4 Measurement ID (e.g. G-XXXXXXXXXX) to track page views and events. Get it from{" "}
            <a href="https://analytics.google.com" target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>
              analytics.google.com
            </a> → Admin → Data Streams.
          </p>
          <div className="form-group">
            <label>GA4 Measurement ID</label>
            <input
              value={gaId}
              onChange={(e) => setGaId(e.target.value)}
              placeholder="G-XXXXXXXXXX"
            />
          </div>

          <h2 className="card-subtitle" style={{ marginTop: "1.5rem" }}>Google Tag Manager (optional)</h2>
          <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginBottom: "1rem" }}>
            If you use GTM to manage GA and Ads, enter your container ID (e.g. GTM-XXXXXXX).
          </p>
          <div className="form-group">
            <label>GTM Container ID</label>
            <input
              value={gtmId}
              onChange={(e) => setGtmId(e.target.value)}
              placeholder="GTM-XXXXXXX"
            />
          </div>
        </div>
      )}

      {/* ─── Google Ads ─────────────────────────────────────────── */}
      {tab === "ads" && (
        <div className="card card-form">
          <h2 className="card-subtitle">Google Ads Conversion Tracking</h2>
          <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginBottom: "1.5rem" }}>
            Add conversion tracking for Google Ads. Get these from{" "}
            <a href="https://ads.google.com" target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>
              ads.google.com
            </a> → Tools → Conversions.
          </p>
          <div className="form-group">
            <label>Conversion ID (AW-XXXXXXXXX)</label>
            <input
              value={adsId}
              onChange={(e) => setAdsId(e.target.value)}
              placeholder="AW-XXXXXXXXX"
            />
          </div>
          <div className="form-group">
            <label>Conversion Label (optional)</label>
            <input
              value={adsLabel}
              onChange={(e) => setAdsLabel(e.target.value)}
              placeholder="AbCdEfGhIjKlMnOp"
            />
          </div>
        </div>
      )}

      {/* ─── Google OAuth ────────────────────────────────────────── */}
      {tab === "oauth" && (
        <div className="card card-form">
          <h2 className="card-subtitle">Google OAuth (Sign in with Google)</h2>
          <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginBottom: "1.5rem" }}>
            Configure Google OAuth for &quot;Sign in with Google&quot;. Create credentials at{" "}
            <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>
              Google Cloud Console
            </a> → APIs &amp; Services → Credentials → OAuth 2.0 Client IDs.
          </p>
          <div className="form-group">
            <label>Client ID</label>
            <input
              value={oauthClientId}
              onChange={(e) => setOauthClientId(e.target.value)}
              placeholder="xxxxx.apps.googleusercontent.com"
            />
          </div>
          <div className="form-group">
            <label>Client Secret</label>
            <input
              type="password"
              value={oauthClientSecret}
              onChange={(e) => setOauthClientSecret(e.target.value)}
              placeholder={settings?.google_oauth_client_secret_masked || "Leave blank to keep current"}
              autoComplete="new-password"
            />
            {settings?.google_oauth_client_secret_masked && (
              <p style={{ color: "var(--text-muted)", fontSize: "0.8rem", margin: "0.25rem 0 0" }}>
                Current: {settings.google_oauth_client_secret_masked}
              </p>
            )}
          </div>
          <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginTop: "0.5rem" }}>
            Add your API redirect URI in Google Cloud Console (e.g. <code>https://your-api.com/api/auth/google/callback</code>).
          </p>
        </div>
      )}

      {/* ─── reCAPTCHA ───────────────────────────────────────────── */}
      {tab === "recaptcha" && (
        <div className="card card-form">
          <h2 className="card-subtitle">Google reCAPTCHA (Login protection)</h2>
          <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginBottom: "1.5rem" }}>
            Add reCAPTCHA v2 to the login page to prevent bots. Get your keys from{" "}
            <a href="https://www.google.com/recaptcha/admin" target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>
              google.com/recaptcha/admin
            </a> — create a reCAPTCHA v2 &quot;I&apos;m not a robot&quot; Checkbox site.
          </p>
          <div className="form-group">
            <label>Site Key (public)</label>
            <input
              value={recaptchaSiteKey}
              onChange={(e) => setRecaptchaSiteKey(e.target.value)}
              placeholder="6Lc..."
            />
          </div>
          <div className="form-group">
            <label>Secret Key</label>
            <input
              type="password"
              value={recaptchaSecretKey}
              onChange={(e) => setRecaptchaSecretKey(e.target.value)}
              placeholder={settings?.recaptcha_secret_key_masked || "Leave blank to keep current"}
              autoComplete="new-password"
            />
            {settings?.recaptcha_secret_key_masked && (
              <p style={{ color: "var(--text-muted)", fontSize: "0.8rem", margin: "0.25rem 0 0" }}>
                Current: {settings.recaptcha_secret_key_masked}
              </p>
            )}
          </div>
          <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginTop: "0.5rem" }}>
            If both keys are empty, reCAPTCHA is disabled. Add your domains (e.g. localhost, yourdomain.com) in the reCAPTCHA admin before enabling, or the captcha will not appear on the login page.
          </p>
        </div>
      )}

      {/* ─── SEO & Keywords ──────────────────────────────────────── */}
      {tab === "seo" && (
        <div className="card card-form">
          <h2 className="card-subtitle">SEO & Search Engine Optimization</h2>
          <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginBottom: "1.5rem" }}>
            Meta tags and keywords for Google and other search engines. These appear in search results and social shares.
          </p>
          <div className="form-group">
            <label>Site Title</label>
            <input
              value={seoTitle}
              onChange={(e) => setSeoTitle(e.target.value)}
              placeholder="SSHCONTROL - SSH Server Management"
            />
          </div>
          <div className="form-group">
            <label>Meta Description</label>
            <textarea
              value={seoDesc}
              onChange={(e) => setSeoDesc(e.target.value)}
              placeholder="Manage SSH access to your servers. Role-based access, audit logs, and key sync."
              rows={3}
              style={{ resize: "vertical", minHeight: 80 }}
            />
            <p style={{ color: "var(--text-muted)", fontSize: "0.8rem", marginTop: "0.25rem" }}>
              Recommended: 150–160 characters for best display in search results.
            </p>
          </div>
          <div className="form-group">
            <label>Keywords (comma-separated)</label>
            <input
              value={seoKeywords}
              onChange={(e) => setSeoKeywords(e.target.value)}
              placeholder="ssh, server management, linux, devops, access control"
            />
          </div>
          <div className="form-group">
            <label>Open Graph Image URL</label>
            <input
              value={seoOgImage}
              onChange={(e) => setSeoOgImage(e.target.value)}
              placeholder="https://yoursite.com/og-image.png"
            />
            <p style={{ color: "var(--text-muted)", fontSize: "0.8rem", marginTop: "0.25rem" }}>
              Image shown when sharing on social media (recommended: 1200×630px).
            </p>
          </div>
        </div>
      )}

      <div style={{ marginTop: "1.5rem" }}>
        <button className="primary" onClick={saveSettings} disabled={saving}>
          {saving ? "Saving..." : "Save All Settings"}
        </button>
      </div>
    </div>
  );
}
