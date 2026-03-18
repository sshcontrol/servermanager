import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { api, downloadFile } from "../api/client";
import DestructiveVerificationModal from "../components/DestructiveVerificationModal";
import Toggle from "../components/Toggle";

type PaymentSettingsData = {
  stripe_secret_key_masked: string;
  stripe_publishable_key: string;
  stripe_webhook_secret_masked: string;
  stripe_enabled: boolean;
  renewal_reminder_days_before: number;
  renewal_reminder_send_email: boolean;
  renewal_reminder_send_sms: boolean;
  renewal_reminder_send_notification: boolean;
  overdue_reminder_email: string;
};

type TabId = "stripe" | "renewal" | "transactions";

type TransactionItem = {
  id: string;
  tenant_id: string;
  company_name: string;
  plan_name: string;
  amount: string;
  currency: string;
  status: string;
  created_at: string;
  failure_reason?: string | null;
};

type DueDateItem = {
  tenant_id: string;
  company_name: string;
  plan_name: string;
  expires_at: string;
  auto_renew: boolean;
};

type IncomeSummary = {
  today_total: string;
  today_currency: string;
  month_total: string;
  month_currency: string;
};

export default function SuperadminPayment() {
  const [tab, setTab] = useState<TabId>("stripe");
  const [settings, setSettings] = useState<PaymentSettingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);

  const [stripeSecretKey, setStripeSecretKey] = useState("");
  const [stripePublishableKey, setStripePublishableKey] = useState("");
  const [stripeWebhookSecret, setStripeWebhookSecret] = useState("");
  const [stripeEnabled, setStripeEnabled] = useState(false);
  const [renewalDaysBefore, setRenewalDaysBefore] = useState(3);
  const [renewalEmail, setRenewalEmail] = useState(true);
  const [renewalSms, setRenewalSms] = useState(false);
  const [renewalNotification, setRenewalNotification] = useState(true);
  const [overdueReminderEmail, setOverdueReminderEmail] = useState("info@sshcontrol.com");
  const [transactions, setTransactions] = useState<TransactionItem[]>([]);
  const [dueDates, setDueDates] = useState<DueDateItem[]>([]);
  const [transactionsLoading, setTransactionsLoading] = useState(false);
  const [incomeSummary, setIncomeSummary] = useState<IncomeSummary | null>(null);
  const [incomeLoading, setIncomeLoading] = useState(false);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [exporting, setExporting] = useState(false);
  const [verifyModal, setVerifyModal] = useState<{ action: "refund_transaction" | "recharge_transaction"; tx: TransactionItem } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchSettings = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.get<PaymentSettingsData & Record<string, unknown>>("/api/superadmin/settings");
      setSettings(res);
      setStripePublishableKey(res.stripe_publishable_key || "");
      setStripeEnabled(res.stripe_enabled ?? false);
      setRenewalDaysBefore(res.renewal_reminder_days_before ?? 3);
      setRenewalEmail(res.renewal_reminder_send_email ?? true);
      setRenewalSms(res.renewal_reminder_send_sms ?? false);
      setRenewalNotification(res.renewal_reminder_send_notification ?? true);
      setOverdueReminderEmail(res.overdue_reminder_email ?? "info@sshcontrol.com");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchTransactions = async () => {
    setTransactionsLoading(true);
    try {
      const [txRes, dueRes] = await Promise.all([
        api.get<TransactionItem[]>("/api/superadmin/payment/transactions"),
        api.get<DueDateItem[]>("/api/superadmin/payment/due-dates"),
      ]);
      setTransactions(txRes);
      setDueDates(dueRes);
    } catch {
      setTransactions([]);
      setDueDates([]);
    } finally {
      setTransactionsLoading(false);
    }
  };

  const fetchIncomeSummary = async () => {
    setIncomeLoading(true);
    try {
      const res = await api.get<IncomeSummary>("/api/superadmin/payment/income-summary");
      setIncomeSummary(res);
    } catch {
      setIncomeSummary(null);
    } finally {
      setIncomeLoading(false);
    }
  };

  useEffect(() => {
    if (tab === "transactions") {
      fetchTransactions();
      fetchIncomeSummary();
    }
  }, [tab]);

  const saveSettings = async () => {
    setSaving(true);
    setMsg("");
    setError("");
    try {
      const payload: Record<string, unknown> = {
        stripe_publishable_key: stripePublishableKey.trim(),
        stripe_enabled: stripeEnabled,
        renewal_reminder_days_before: renewalDaysBefore,
        renewal_reminder_send_email: renewalEmail,
        renewal_reminder_send_sms: renewalSms,
        renewal_reminder_send_notification: renewalNotification,
        overdue_reminder_email: overdueReminderEmail.trim() || undefined,
      };
      if (stripeSecretKey) payload.stripe_secret_key = stripeSecretKey;
      if (stripeWebhookSecret) payload.stripe_webhook_secret = stripeWebhookSecret;
      await api.patch("/api/superadmin/settings", payload);
      setMsg("Payment settings saved successfully");
      setStripeSecretKey("");
      setStripeWebhookSecret("");
      await fetchSettings();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleRefundRecharge = async (verificationToken: string) => {
    if (!verifyModal) return;
    setActionLoading(true);
    setError("");
    try {
      const action = verifyModal.action === "refund_transaction" ? "refund" : "recharge";
      await api.post(
        `/api/superadmin/payment/transactions/${verifyModal.tx.id}/${action}`,
        {},
        { headers: { "X-Destructive-Verification": verificationToken } },
      );
      setMsg(verifyModal.action === "refund_transaction" ? "Refund successful" : "Recharge successful");
      setVerifyModal(null);
      fetchTransactions();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setActionLoading(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (customFrom) params.set("from", customFrom);
      if (customTo) params.set("to", customTo);
      const path = `/api/superadmin/payment/export?${params}`;
      const suggestedName = customFrom && customTo
        ? `payments-report-${customFrom}-${customTo}.csv`
        : "payments-report.csv";
      await downloadFile(path, suggestedName, true); // allowEmpty: CSV can be header-only
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
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
          <h1 style={{ marginTop: "0.5rem" }}>Payment & Billing</h1>
        </div>
        <p style={{ color: "var(--text-muted)" }}>Loading...</p>
      </div>
    );
  }

  return (
    <div className="container app-page">
      <div className="page-header">
        <Link to="/superadmin/tenants" className="btn-link">← Superadmin</Link>
        <h1 style={{ marginTop: "0.5rem" }}>Payment & Billing</h1>
        <p style={{ color: "var(--text-muted)", fontSize: "0.95rem", marginTop: "0.25rem" }}>
          Stripe integration and renewal reminder settings
        </p>
      </div>

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
        {tabBtn("stripe", "Stripe Keys")}
        {tabBtn("renewal", "Renewal Reminders")}
        {tabBtn("transactions", "Transactions & Due Dates")}
      </div>

      {msg && <p style={{ color: "var(--accent)", marginBottom: "1rem" }}>{msg}</p>}
      {error && <p className="error-msg" style={{ marginBottom: "1rem" }}>{error}</p>}

      {tab === "stripe" && (
        <div className="card" style={{ maxWidth: 600 }}>
          <h2 className="card-subtitle">Stripe Integration</h2>
          <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginBottom: "1.5rem" }}>
            Configure Stripe for prepaid plan upgrades. Get your keys from{" "}
            <a href="https://dashboard.stripe.com/apikeys" target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>
              Stripe Dashboard → Developers → API keys
            </a>.
            Use test keys (pk_test_, sk_test_) for development.
          </p>
          <div className="form-group">
            <label>Publishable Key (pk_live_... or pk_test_...)</label>
            <input
              value={stripePublishableKey}
              onChange={(e) => setStripePublishableKey(e.target.value)}
              placeholder="pk_live_xxxxxxxxxxxx"
            />
          </div>
          <div className="form-group">
            <label>Secret Key (sk_live_... or sk_test_...)</label>
            <input
              type="password"
              value={stripeSecretKey}
              onChange={(e) => setStripeSecretKey(e.target.value)}
              placeholder={settings?.stripe_secret_key_masked || "Leave blank to keep current"}
              autoComplete="new-password"
            />
            {settings?.stripe_secret_key_masked && (
              <p style={{ color: "var(--text-muted)", fontSize: "0.8rem", margin: "0.25rem 0 0", wordBreak: "break-all" }}>
                Current: <code style={{ fontSize: "0.85em" }}>{settings.stripe_secret_key_masked}</code>
              </p>
            )}
          </div>
          <div className="form-group">
            <label>Webhook Secret (whsec_...)</label>
            <input
              type="password"
              value={stripeWebhookSecret}
              onChange={(e) => setStripeWebhookSecret(e.target.value)}
              placeholder={settings?.stripe_webhook_secret_masked || "Leave blank to keep current"}
              autoComplete="new-password"
            />
            {settings?.stripe_webhook_secret_masked && (
              <p style={{ color: "var(--text-muted)", fontSize: "0.8rem", margin: "0.25rem 0 0", wordBreak: "break-all" }}>
                Current: <code style={{ fontSize: "0.85em" }}>{settings.stripe_webhook_secret_masked}</code>
              </p>
            )}
            <p style={{ color: "var(--text-muted)", fontSize: "0.8rem", marginTop: "0.25rem" }}>
              Required for webhook verification. Add endpoint: <code>https://yourdomain.com/api/webhooks/stripe</code>
            </p>
          </div>

          <div style={{ marginTop: "1.5rem", paddingTop: "1rem", borderTop: "1px solid rgba(255,255,255,0.1)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "1rem" }}>
              <div>
                <div style={{ fontWeight: 600, color: "var(--text-primary)", marginBottom: "0.25rem" }}>Stripe payments</div>
                <p style={{ color: "var(--text-muted)", fontSize: "0.8rem", margin: 0 }}>
                  {stripeEnabled ? "Enabled — tenants can upgrade plans via Stripe Checkout." : "Disabled — tenants cannot pay via Stripe."}
                </p>
              </div>
              <button
                type="button"
                className={stripeEnabled ? "secondary" : "primary"}
                onClick={() => setStripeEnabled(!stripeEnabled)}
                style={{ minWidth: 100 }}
              >
                {stripeEnabled ? "Disable" : "Enable"}
              </button>
            </div>
          </div>
        </div>
      )}

      {tab === "renewal" && (
        <div className="card" style={{ maxWidth: 600 }}>
          <h2 className="card-subtitle">Renewal Reminders</h2>
          <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginBottom: "1.5rem" }}>
            When a subscription is about to expire, send reminders to the tenant admin. Choose how many days before the due date and which channels to use.
          </p>
          <div className="form-group">
            <label>Days before expiry to send reminder</label>
            <input
              type="number"
              min={0}
              max={90}
              value={renewalDaysBefore}
              onChange={(e) => setRenewalDaysBefore(parseInt(e.target.value, 10) || 0)}
            />
            <p style={{ color: "var(--text-muted)", fontSize: "0.8rem", marginTop: "0.25rem" }}>
              e.g. 3 = send reminder 3 days before the subscription expires
            </p>
          </div>
          <div className="form-group">
            <label>Channels to use</label>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.5rem" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "0.75rem", cursor: "pointer" }}>
                <Toggle checked={renewalEmail} onChange={setRenewalEmail} />
                Email
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "0.75rem", cursor: "pointer" }}>
                <Toggle checked={renewalNotification} onChange={setRenewalNotification} />
                In-app notification
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "0.75rem", cursor: "pointer" }}>
                <Toggle checked={renewalSms} onChange={setRenewalSms} />
                SMS (requires SMS provider integration)
              </label>
            </div>
          </div>
          <div className="form-group">
            <label>Overdue reminder email</label>
            <input
              type="email"
              value={overdueReminderEmail}
              onChange={(e) => setOverdueReminderEmail(e.target.value)}
              placeholder="info@sshcontrol.com"
            />
            <p style={{ color: "var(--text-muted)", fontSize: "0.8rem", marginTop: "0.25rem" }}>
              Daily overdue reminders are sent to this address and to the tenant admin when paid plans are past due. Account suspended after 10 days.
            </p>
          </div>
        </div>
      )}

      {tab === "transactions" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          {/* Income summary - 3 lines */}
          <div className="card" style={{ maxWidth: "100%" }}>
            <h2 className="card-subtitle">Total Income</h2>
            {incomeLoading ? (
              <p style={{ color: "var(--text-muted)" }}>Loading...</p>
            ) : incomeSummary ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.5rem 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                  <span style={{ color: "var(--text-secondary)" }}>Total received today</span>
                  <span style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--accent)" }}>
                    {incomeSummary.today_currency} {incomeSummary.today_total}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.5rem 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                  <span style={{ color: "var(--text-secondary)" }}>Total received this month</span>
                  <span style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--accent)" }}>
                    {incomeSummary.month_currency} {incomeSummary.month_total}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.75rem 0", flexWrap: "wrap" }}>
                  <span style={{ color: "var(--text-secondary)", flexShrink: 0 }}>Export report</span>
                  <input
                    type="date"
                    value={customFrom}
                    onChange={(e) => setCustomFrom(e.target.value)}
                    style={{ padding: "0.3rem 0.4rem", fontSize: "0.8rem", width: 130, maxWidth: "100%" }}
                  />
                  <span style={{ color: "var(--text-muted)", flexShrink: 0 }}>to</span>
                  <input
                    type="date"
                    value={customTo}
                    onChange={(e) => setCustomTo(e.target.value)}
                    style={{ padding: "0.3rem 0.4rem", fontSize: "0.8rem", width: 130, maxWidth: "100%" }}
                  />
                  <button
                    className="primary"
                    onClick={handleExport}
                    disabled={exporting}
                    style={{ flexShrink: 0 }}
                  >
                    {exporting ? "Exporting..." : "Download CSV"}
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          <div className="card" style={{ maxWidth: "100%" }}>
            <h2 className="card-subtitle">Payment Transactions</h2>
            {transactionsLoading ? (
              <p style={{ color: "var(--text-muted)" }}>Loading...</p>
            ) : transactions.length === 0 ? (
              <p style={{ color: "var(--text-muted)" }}>No transactions yet.</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Tenant</th>
                      <th>Plan</th>
                      <th>Amount</th>
                      <th>Status</th>
                      <th>Invoice</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map((t) => (
                      <tr key={t.id}>
                        <td>{new Date(t.created_at).toLocaleString()}</td>
                        <td>{t.company_name}</td>
                        <td>{t.plan_name}</td>
                        <td>{t.currency} {t.amount}</td>
                        <td>
                          <span className={`badge badge-${t.status === "succeeded" ? "success" : t.status === "failed" ? "error" : "secondary"}`}>
                            {t.status}
                          </span>
                          {t.failure_reason && (
                            <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>{t.failure_reason}</div>
                          )}
                        </td>
                        <td>
                          {t.status === "succeeded" && (
                            <button
                              className="btn-sm secondary"
                              onClick={() => downloadFile(`/api/superadmin/payment/invoices/${t.id}/download`, `invoice-${t.company_name}-${t.id.slice(0, 8)}.pdf`).catch((e) => setError(e instanceof Error ? e.message : "Download failed"))}
                            >
                              Download PDF
                            </button>
                          )}
                        </td>
                        <td>
                          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                            {t.status === "succeeded" && (
                              <button
                                className="btn-sm secondary"
                                style={{ color: "var(--danger, #ef4444)" }}
                                disabled={actionLoading}
                                onClick={() => setVerifyModal({ action: "refund_transaction", tx: t })}
                              >
                                Refund
                              </button>
                            )}
                            {(t.status === "failed" || t.status === "succeeded") && (
                              <button
                                className="btn-sm secondary"
                                disabled={actionLoading}
                                onClick={() => setVerifyModal({ action: "recharge_transaction", tx: t })}
                              >
                                Recharge
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="card" style={{ maxWidth: "100%" }}>
            <h2 className="card-subtitle">Subscription Due Dates</h2>
            {transactionsLoading ? (
              <p style={{ color: "var(--text-muted)" }}>Loading...</p>
            ) : dueDates.length === 0 ? (
              <p style={{ color: "var(--text-muted)" }}>No active subscriptions with expiry dates.</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Tenant</th>
                      <th>Plan</th>
                      <th>Expires</th>
                      <th>Auto-renew</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dueDates.map((d, i) => (
                      <tr key={`${d.tenant_id}-${d.expires_at}-${i}`}>
                        <td>{d.company_name}</td>
                        <td>{d.plan_name}</td>
                        <td>{new Date(d.expires_at).toLocaleDateString()}</td>
                        <td>{d.auto_renew ? "Yes" : "No"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      <div style={{ marginTop: "1.5rem" }}>
        <button className="primary" onClick={saveSettings} disabled={saving}>
          {saving ? "Saving..." : "Save Settings"}
        </button>
      </div>

      {verifyModal && (
        <DestructiveVerificationModal
          open={!!verifyModal}
          title={verifyModal.action === "refund_transaction" ? "Refund Payment" : "Recharge Payment"}
          message={
            verifyModal.action === "refund_transaction"
              ? `Refund ${verifyModal.tx.currency} ${verifyModal.tx.amount} to ${verifyModal.tx.company_name}?`
              : `Charge ${verifyModal.tx.currency} ${verifyModal.tx.amount} from ${verifyModal.tx.company_name}?`
          }
          action={verifyModal.action}
          targetId={verifyModal.tx.id}
          targetName={`${verifyModal.tx.company_name} - ${verifyModal.tx.currency} ${verifyModal.tx.amount}`}
          requirePassword
          onVerified={handleRefundRecharge}
          onCancel={() => setVerifyModal(null)}
        />
      )}
    </div>
  );
}
