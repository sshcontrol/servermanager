import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { api, downloadFile } from "../api/client";

type BillingInfo = {
  billing_address?: {
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    postal_code?: string;
    country?: string;
  } | null;
  billing_email?: string | null;
  receive_invoices: boolean;
  plan_name?: string | null;
  expires_at?: string | null;
  auto_renew: boolean;
};

type PaymentItem = {
  id: string;
  amount: string;
  currency: string;
  status: string;
  plan_name?: string | null;
  created_at: string;
  failure_reason?: string | null;
};

type ProfileBillingProps = { embedded?: boolean; showPaymentHistory?: boolean };

export default function ProfileBilling({ showPaymentHistory = true }: ProfileBillingProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [info, setInfo] = useState<BillingInfo | null>(null);
  const [payments, setPayments] = useState<PaymentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  const [line1, setLine1] = useState("");
  const [line2, setLine2] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [country, setCountry] = useState("");
  const [billingEmail, setBillingEmail] = useState("");
  const [receiveInvoices, setReceiveInvoices] = useState(true);

  const fetchData = async () => {
    setLoading(true);
    setError("");
    try {
      const [infoRes, paymentsRes] = await Promise.all([
        api.get<BillingInfo>("/api/admin/billing"),
        api.get<PaymentItem[]>("/api/admin/billing/payments"),
      ]);
      setInfo(infoRes);
      setPayments(paymentsRes);
      const addr = infoRes.billing_address || {};
      setLine1(addr.line1 || "");
      setLine2(addr.line2 || "");
      setCity(addr.city || "");
      setState(addr.state || "");
      setPostalCode(addr.postal_code || "");
      setCountry(addr.country || "");
      setBillingEmail(infoRes.billing_email || "");
      setReceiveInvoices(infoRes.receive_invoices ?? true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (searchParams.get("success") === "true") {
      setMsg("Payment successful! Your plan has been upgraded.");
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const saveAddress = async () => {
    setSaving(true);
    setMsg("");
    setError("");
    try {
      await api.patch("/api/admin/billing", {
        line1: line1.trim() || undefined,
        line2: line2.trim() || undefined,
        city: city.trim() || undefined,
        state: state.trim() || undefined,
        postal_code: postalCode.trim() || undefined,
        country: country.trim() || undefined,
        billing_email: billingEmail.trim() || undefined,
        receive_invoices: receiveInvoices,
      });
      setMsg("Billing info saved");
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const cancelAutoRenew = async () => {
    if (!confirm("Cancel auto payment? Your plan will remain active until the end of the billing period. You will not be charged again.")) return;
    setSaving(true);
    setError("");
    try {
      await api.post("/api/admin/billing/cancel");
      setMsg("Auto-renew disabled");
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="profile-section">
        <div className="profile-section-card"><p style={{ color: "var(--text-muted)" }}>Loading...</p></div>
      </div>
    );
  }

  return (
    <div className="profile-section">
      {msg && <p style={{ color: "var(--accent)", marginBottom: "1rem" }}>{msg}</p>}
      {error && <p className="error-msg" style={{ marginBottom: "1rem" }}>{error}</p>}

      {/* Current plan & expiry - shown on both Billing and Payment tabs */}
      {info && (info.plan_name || info.expires_at || info.auto_renew) && (
        <div className="card profile-section-card" style={{ marginBottom: "1.5rem" }}>
          <h2 className="card-subtitle">Current Plan</h2>
          <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
            {info.plan_name && (
              <div>
                <div style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>Plan</div>
                <div style={{ fontWeight: 600 }}>{info.plan_name}</div>
              </div>
            )}
            {info.expires_at && (
              <div>
                <div style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>Expires</div>
                <div style={{ fontWeight: 600 }}>
                  {new Date(info.expires_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
                </div>
              </div>
            )}
            {info.auto_renew && (
              <div>
                <span className="badge badge-success">Auto-renew on</span>
              </div>
            )}
          </div>
          {info.auto_renew && (
            <button className="secondary" onClick={cancelAutoRenew} disabled={saving} style={{ marginTop: "1rem" }}>
              Cancel auto payment
            </button>
          )}
        </div>
      )}

      {/* Billing address */}
      <div className="card profile-section-card" style={{ marginBottom: "1.5rem" }}>
        <h2 className="card-subtitle">Billing Address</h2>
        <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginBottom: "1rem" }}>
          Used for invoices and receipts.
        </p>
        <div className="form-group">
          <label>Address line 1</label>
          <input value={line1} onChange={(e) => setLine1(e.target.value)} placeholder="Street address" />
        </div>
        <div className="form-group">
          <label>Address line 2</label>
          <input value={line2} onChange={(e) => setLine2(e.target.value)} placeholder="Apt, suite, etc. (optional)" />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
          <div className="form-group">
            <label>City</label>
            <input value={city} onChange={(e) => setCity(e.target.value)} />
          </div>
          <div className="form-group">
            <label>State / Province</label>
            <input value={state} onChange={(e) => setState(e.target.value)} />
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
          <div className="form-group">
            <label>Postal code</label>
            <input value={postalCode} onChange={(e) => setPostalCode(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Country</label>
            <input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="e.g. US" />
          </div>
        </div>
        <div className="form-group">
          <label>Email for invoices</label>
          <input
            type="email"
            value={billingEmail}
            onChange={(e) => setBillingEmail(e.target.value)}
            placeholder="billing@company.com"
          />
          <p style={{ color: "var(--text-muted)", fontSize: "0.8rem", marginTop: "0.25rem" }}>
            Invoices will be sent to this address when enabled below.
          </p>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "0.75rem",
            marginBottom: "1rem",
            padding: "0.5rem 0",
          }}
        >
          <span style={{ fontSize: "0.9rem", color: "var(--text-secondary)" }}>
            Receive invoices by email
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={receiveInvoices}
            onClick={() => setReceiveInvoices(!receiveInvoices)}
            style={{
              position: "relative",
              width: 44,
              height: 24,
              borderRadius: 12,
              border: "none",
              cursor: "pointer",
              background: receiveInvoices ? "var(--accent)" : "rgba(255,255,255,0.2)",
              transition: "background 0.2s",
              flexShrink: 0,
            }}
          >
            <span
              style={{
                position: "absolute",
                top: 2,
                left: receiveInvoices ? 22 : 2,
                width: 20,
                height: 20,
                borderRadius: "50%",
                background: "#fff",
                boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
                transition: "left 0.2s",
              }}
            />
          </button>
        </div>
        <button className="primary" onClick={saveAddress} disabled={saving}>
          {saving ? "Saving..." : "Save Billing Info"}
        </button>
      </div>

      {/* Payment history & Invoices */}
      {showPaymentHistory && (
      <div className="card profile-section-card">
        <h2 className="card-subtitle">Payment History & Invoices</h2>
        {payments.length === 0 ? (
          <p style={{ color: "var(--text-muted)" }}>No payments yet.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Amount</th>
                  <th>Plan</th>
                  <th>Status</th>
                  <th>Invoice</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td>{new Date(p.created_at).toLocaleDateString()}</td>
                    <td>{p.currency} {p.amount}</td>
                    <td>{p.plan_name || "—"}</td>
                    <td>
                      <span className={`badge badge-${p.status === "succeeded" ? "success" : p.status === "failed" ? "error" : "secondary"}`}>
                        {p.status}
                      </span>
                      {p.failure_reason && (
                        <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
                          {p.failure_reason}
                        </div>
                      )}
                    </td>
                        <td>
                          {p.status === "succeeded" && (
                            <button
                              className="btn-sm secondary"
                              onClick={() => downloadFile(`/api/admin/billing/invoices/${p.id}/download`, `invoice-${p.id.slice(0, 8)}.pdf`).catch((e) => setError(e instanceof Error ? e.message : "Download failed"))}
                            >
                              Download PDF
                            </button>
                          )}
                        </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      )}
    </div>
  );
}
