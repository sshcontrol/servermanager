import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { downloadFile } from "../api/client";

type ProfileImportExportProps = { embedded?: boolean };

export default function ProfileImportExport({ embedded }: ProfileImportExportProps) {
  const { isAdmin } = useAuth();
  const [historyExporting, setHistoryExporting] = useState(false);
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);

  if (!isAdmin) {
    return (
      <div className={embedded ? "profile-section" : "container app-page"}>
        <div className="profile-section-card">
          <p className="error-msg">Admin access required.</p>
          {!embedded && <Link to="/">← Dashboard</Link>}
        </div>
      </div>
    );
  }

  const content = (
    <>
      {!embedded && (
        <div className="page-header">
          <Link to="/" className="btn-link">← Dashboard</Link>
          <h1 style={{ marginTop: "0.5rem" }}>History Export</h1>
        </div>
      )}
      <p style={{ color: "var(--text-muted)", marginBottom: "1.5rem", fontSize: "0.95rem" }}>
        Export your organization's audit history as a CSV report.
      </p>

      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <h2 className="card-subtitle">History report (CSV)</h2>
        <p style={{ fontSize: "0.9rem", color: "var(--text-muted)", marginBottom: "0.75rem" }}>
          Download the full audit log as a human-readable CSV file.
        </p>
        <button
          type="button"
          disabled={historyExporting}
          onClick={async () => {
            setMessage(null);
            setHistoryExporting(true);
            try {
              await downloadFile("/api/admin/backup/history-csv", "servermanager-history.csv");
              setMessage({ type: "success", text: "History CSV downloaded." });
            } catch (e) {
              setMessage({ type: "error", text: e instanceof Error ? e.message : "Export failed" });
            } finally {
              setHistoryExporting(false);
            }
          }}
        >
          {historyExporting ? "Preparing…" : "Export history (CSV)"}
        </button>
      </div>

      {message && (
        <p className={message.type === "error" ? "error-msg" : "success-msg"} style={{ marginTop: "0.5rem" }}>
          {message.text}
        </p>
      )}
    </>
  );

  if (embedded) {
    return <div className="profile-section">{content}</div>;
  }
  return <div className="container app-page">{content}</div>;
}
