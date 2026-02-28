import { useState, useEffect } from "react";
import { api, downloadFile } from "../api/client";

type BillingInfo = {
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

export default function ProfilePaymentHistory() {
  const [info, setInfo] = useState<BillingInfo | null>(null);
  const [payments, setPayments] = useState<PaymentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const cancelAutoRenew = async () => {
    if (!confirm("Cancel auto payment? Your plan will remain active until the end of the billing period. You will not be charged again.")) return;
    setSaving(true);
    setError("");
    try {
      await api.post("/api/admin/billing/cancel");
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
      {error && <p className="error-msg" style={{ marginBottom: "1rem" }}>{error}</p>}

      {info && (info.plan_name || info.expires_at) && (
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
    </div>
  );
}
