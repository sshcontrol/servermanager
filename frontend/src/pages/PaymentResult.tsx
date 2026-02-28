import { useState, useEffect } from "react";
import { Link, useSearchParams, Navigate } from "react-router-dom";
import { api, downloadFile } from "../api/client";
import { useAuth } from "../contexts/AuthContext";
import Logo from "../components/Logo";
import LogoSpinner from "../components/LogoSpinner";

type VerifyResult = {
  verified?: boolean;
  transaction_id?: string;
  old_plan_name?: string | null;
  new_plan_name?: string;
  amount?: string;
  currency?: string;
};

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "#0a1628",
  padding: "2rem",
  flexDirection: "column",
  gap: "2rem",
};

const cardStyle: React.CSSProperties = {
  background: "rgba(10, 22, 40, 0.95)",
  border: "1px solid rgba(255, 255, 255, 0.1)",
  borderRadius: 16,
  padding: "2.5rem",
  maxWidth: 520,
  width: "100%",
  margin: "0 auto",
  textAlign: "center",
};

const btnPrimary: React.CSSProperties = {
  background: "linear-gradient(135deg, #2dd4bf, #14b8a6)",
  color: "#022c22",
  fontWeight: 600,
  padding: "0.75rem 2rem",
  borderRadius: 10,
  border: "none",
  cursor: "pointer",
  fontSize: "0.95rem",
  textDecoration: "none",
  display: "inline-block",
};

const btnSecondary: React.CSSProperties = {
  background: "rgba(255,255,255,0.08)",
  color: "#94a3b8",
  fontWeight: 500,
  padding: "0.75rem 2rem",
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.12)",
  cursor: "pointer",
  fontSize: "0.9rem",
  textDecoration: "none",
  display: "inline-block",
};

export default function PaymentResult() {
  const { user, loading: authLoading } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState(false);

  const sessionId = searchParams.get("session_id");
  const success = searchParams.get("payment_success");
  const canceled = searchParams.get("canceled");

  useEffect(() => {
    if (success !== "true" || !sessionId) {
      setLoading(false);
      return;
    }
    const verify = async () => {
      try {
        const res = await api.post<VerifyResult>("/api/admin/billing/verify-session", { session_id: sessionId });
        setResult(res);
        setSearchParams({}, { replace: true });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not verify payment");
      } finally {
        setLoading(false);
      }
    };
    verify();
  }, [success, sessionId, setSearchParams]);

  const handleDownloadInvoice = async () => {
    if (!result?.transaction_id) return;
    setDownloading(true);
    try {
      await downloadFile(
        `/api/admin/billing/invoices/${result.transaction_id}/download`,
        `invoice-${result.transaction_id.slice(0, 8)}.pdf`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed");
    } finally {
      setDownloading(false);
    }
  };

  if (authLoading) {
    return (
      <div style={pageStyle}>
        <LogoSpinner />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Loading: verifying payment
  if (loading && success === "true" && sessionId) {
    return (
      <div style={pageStyle}>
        <Link to="/" style={{ position: "absolute", top: "1.5rem", left: "1.5rem", color: "#94a3b8", fontSize: "0.9rem" }}>
          ← Back to app
        </Link>
        <div style={cardStyle}>
          <div style={{ marginBottom: "1.5rem" }}>
            <Logo />
          </div>
          <h1 style={{ color: "#e2e8f0", fontSize: "1.5rem", marginBottom: "0.5rem" }}>Verifying your payment</h1>
          <p style={{ color: "#64748b", margin: 0 }}>Please wait while we confirm your transaction...</p>
          <div style={{ marginTop: "2rem" }}>
            <LogoSpinner />
          </div>
        </div>
      </div>
    );
  }

  // Success (check before error: after verify we clear URL params, so success/sessionId become null)
  if (result && (result.verified !== false)) {
    const oldPlan = result.old_plan_name || "Free";
    const newPlan = result.new_plan_name || "Your new plan";
    const amountStr = result.amount && result.currency ? `${result.currency} ${result.amount}` : "";

    return (
      <div style={pageStyle}>
        <Link to="/" style={{ position: "absolute", top: "1.5rem", left: "1.5rem", color: "#94a3b8", fontSize: "0.9rem" }}>
          ← Back to app
        </Link>
        <div style={{ ...cardStyle, borderColor: "rgba(45, 212, 191, 0.4)", background: "rgba(13, 148, 136, 0.1)" }}>
          <div style={{ marginBottom: "1.5rem" }}>
            <Logo />
          </div>
          <div
            style={{
              width: 72,
              height: 72,
              margin: "0 auto 1.5rem",
              borderRadius: "50%",
              background: "linear-gradient(135deg, #2dd4bf, #14b8a6)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#022c22" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          </div>
          <h1 style={{ color: "#2dd4bf", fontSize: "1.75rem", marginBottom: "0.5rem" }}>Payment received successfully</h1>
          <p style={{ color: "#94a3b8", marginBottom: "1rem", lineHeight: 1.6 }}>
            Your plan has been changed from <strong style={{ color: "#e2e8f0" }}>{oldPlan}</strong> to{" "}
            <strong style={{ color: "#2dd4bf" }}>{newPlan}</strong>.
          </p>
          {amountStr && (
            <p style={{ color: "#64748b", marginBottom: "1rem", fontSize: "0.95rem" }}>
              Amount paid: <strong style={{ color: "#e2e8f0" }}>{amountStr}</strong>
            </p>
          )}
          <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 12, padding: "1rem 1.25rem", marginBottom: "1rem", textAlign: "left" }}>
            <div style={{ color: "#94a3b8", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Current plan</div>
            <div style={{ color: "#2dd4bf", fontSize: "1.25rem", fontWeight: 700 }}>{newPlan}</div>
          </div>
          <p style={{ fontSize: "0.9rem", color: "#94a3b8", marginBottom: "1.5rem" }}>
            You&apos;ll also receive an in-app notification confirming your order.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", alignItems: "center" }}>
            {result.transaction_id && (
              <button
                onClick={handleDownloadInvoice}
                disabled={downloading}
                style={{ ...btnPrimary, minWidth: 220 }}
              >
                {downloading ? "Downloading..." : "Download invoice"}
              </button>
            )}
            <p style={{ fontSize: "0.85rem", color: "#64748b", margin: 0 }}>
              Access all invoices from the{" "}
              <Link to="/plan-billing/billing" style={{ color: "#2dd4bf", fontWeight: 600 }}>
                Billing page
              </Link>
            </p>
          </div>
          <Link to="/plan-billing/plan" style={{ ...btnSecondary, marginTop: "1rem" }}>
            Continue to Plan & Billing
          </Link>
        </div>
      </div>
    );
  }

  // Canceled
  if (canceled === "true") {
    return (
      <div style={pageStyle}>
        <Link to="/" style={{ position: "absolute", top: "1.5rem", left: "1.5rem", color: "#94a3b8", fontSize: "0.9rem" }}>
          ← Back to app
        </Link>
        <div style={{ ...cardStyle, borderColor: "rgba(248, 113, 113, 0.4)", background: "rgba(127, 29, 29, 0.15)" }}>
          <div
            style={{
              width: 64,
              height: 64,
              margin: "0 auto 1.5rem",
              borderRadius: "50%",
              background: "rgba(248, 113, 113, 0.2)",
              border: "2px solid #f87171",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </div>
          <h1 style={{ color: "#fca5a5", fontSize: "1.5rem", marginBottom: "0.5rem" }}>Payment canceled</h1>
          <p style={{ color: "#94a3b8", marginBottom: "1.5rem", lineHeight: 1.5 }}>
            You canceled the payment. No charges were made. You can try again whenever you're ready.
          </p>
          <Link to="/plan-billing/plan" style={btnPrimary}>
            Back to Plan & Billing
          </Link>
        </div>
      </div>
    );
  }

  // Error or unsuccessful (no verified result)
  if (error || (!result && success !== "true" && !sessionId && !canceled)) {
    return (
      <div style={pageStyle}>
        <Link to="/" style={{ position: "absolute", top: "1.5rem", left: "1.5rem", color: "#94a3b8", fontSize: "0.9rem" }}>
          ← Back to app
        </Link>
        <div style={{ ...cardStyle, borderColor: "rgba(248, 113, 113, 0.4)", background: "rgba(127, 29, 29, 0.15)" }}>
          <div
            style={{
              width: 64,
              height: 64,
              margin: "0 auto 1.5rem",
              borderRadius: "50%",
              background: "rgba(248, 113, 113, 0.2)",
              border: "2px solid #f87171",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <h1 style={{ color: "#fca5a5", fontSize: "1.5rem", marginBottom: "0.5rem" }}>Payment unsuccessful</h1>
          <p style={{ color: "#94a3b8", marginBottom: "1.5rem", lineHeight: 1.5 }}>
            {error || "We couldn't verify your payment. Please check your billing page or contact support if you were charged."}
          </p>
          <div style={{ display: "flex", gap: "1rem", justifyContent: "center", flexWrap: "wrap" }}>
            <Link to="/plan-billing/plan" style={btnPrimary}>
              Back to Plan
            </Link>
            <Link to="/plan-billing/billing" style={btnSecondary}>
              View Billing
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Fallback: redirect to plan (e.g. result.verified === false)
  return <Navigate to="/plan-billing/plan" replace />;
}
