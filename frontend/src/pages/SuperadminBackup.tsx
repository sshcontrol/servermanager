import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { postAndDownload } from "../api/client";

const API_BASE = import.meta.env.VITE_API_URL || "";

export default function SuperadminBackup() {
  const { refreshUser } = useAuth();
  const [backupPassword, setBackupPassword] = useState("");
  const [backupExporting, setBackupExporting] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restorePassword, setRestorePassword] = useState("");
  const [restoreConfirm, setRestoreConfirm] = useState("");
  const [restoring, setRestoring] = useState(false);
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);

  return (
    <div className="container app-page">
      <div className="page-header">
        <Link to="/superadmin/tenants" className="btn-link">← Superadmin</Link>
        <h1 style={{ marginTop: "0.5rem" }}>Database Backup</h1>
      </div>
      <p style={{ color: "var(--text-muted)", marginBottom: "1.5rem", fontSize: "0.95rem" }}>
        Download a full encrypted backup of the database or restore from a previous backup. Platform superadmin only.
      </p>

      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <h2 className="card-subtitle">Download full database</h2>
        <p style={{ fontSize: "0.9rem", color: "var(--text-muted)", marginBottom: "0.75rem" }}>
          Set a password (min 8 characters). You must use this same password to restore the backup.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
          <input
            type="password"
            value={backupPassword}
            onChange={(e) => setBackupPassword(e.target.value)}
            placeholder="Backup password"
            minLength={8}
            style={{ maxWidth: "220px", width: "100%" }}
          />
          <button
            type="button"
            className="primary"
            disabled={backupExporting || backupPassword.length < 8}
            onClick={async () => {
              setMessage(null);
              setBackupExporting(true);
              try {
                await postAndDownload("/api/admin/backup/export", { password: backupPassword }, "servermanager-backup.encrypted");
                setMessage({ type: "success", text: "Backup downloaded." });
              } catch (e) {
                setMessage({ type: "error", text: e instanceof Error ? e.message : "Export failed" });
              } finally {
                setBackupExporting(false);
              }
            }}
          >
            {backupExporting ? "Preparing…" : "Download backup"}
          </button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <h2 className="card-subtitle">Restore from backup</h2>
        <p style={{ fontSize: "0.9rem", color: "var(--text-muted)", marginBottom: "0.75rem" }}>
          Upload an encrypted backup file and enter the password used when creating it. Type <strong>restore</strong> to confirm.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxWidth: "400px" }}>
          <input
            type="file"
            accept=".encrypted,application/octet-stream"
            onChange={(e) => setRestoreFile(e.target.files?.[0] ?? null)}
          />
          <input
            type="password"
            value={restorePassword}
            onChange={(e) => setRestorePassword(e.target.value)}
            placeholder="Backup password"
            minLength={8}
          />
          <input
            type="text"
            value={restoreConfirm}
            onChange={(e) => setRestoreConfirm(e.target.value)}
            placeholder="Type 'restore' to confirm"
            autoComplete="off"
          />
          <button
            type="button"
            className="btn-outline-danger"
            disabled={restoring || !restoreFile || restorePassword.length < 8 || restoreConfirm !== "restore"}
            onClick={async () => {
              if (!restoreFile || restoreConfirm !== "restore") return;
              setMessage(null);
              setRestoring(true);
              try {
                const token = localStorage.getItem("access_token");
                const form = new FormData();
                form.append("file", restoreFile);
                form.append("password", restorePassword);
                form.append("confirm", restoreConfirm);
                const res = await fetch(`${API_BASE}/api/admin/backup/import`, {
                  method: "POST",
                  headers: token ? { Authorization: `Bearer ${token}` } : {},
                  body: form,
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) {
                  throw new Error(typeof data.detail === "string" ? data.detail : "Restore failed");
                }
                setMessage({ type: "success", text: "Database restored. You may need to log in again." });
                setRestoreFile(null);
                setRestorePassword("");
                setRestoreConfirm("");
                await refreshUser();
              } catch (e) {
                setMessage({ type: "error", text: e instanceof Error ? e.message : "Restore failed" });
              } finally {
                setRestoring(false);
              }
            }}
          >
            {restoring ? "Restoring…" : "Restore from backup"}
          </button>
        </div>
      </div>

      {message && (
        <p className={message.type === "error" ? "error-msg" : "success-msg"} style={{ marginTop: "0.5rem" }}>
          {message.text}
        </p>
      )}
    </div>
  );
}
