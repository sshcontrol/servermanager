import { useState, useEffect } from "react";
import { api, downloadFile } from "../api/client";
import Spinner from "../components/Spinner";

type LogEntry = {
  id: string;
  created_at: string;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  user_id: string | null;
  username: string | null;
  ip_address: string | null;
  tenant_name: string | null;
  details: string | null;
};

type TenantOption = { id: string; company_name: string };

const ACTION_LABELS: Record<string, string> = {
  server_registered: "Server created",
  server_deleted: "Server deleted",
  access_granted: "Access granted",
  access_revoked: "Access revoked",
  user_created: "User created",
  user_deleted: "User deleted",
  user_login: "User login",
  backup_exported: "Backup exported",
  backup_imported: "Backup imported",
};

const PAGE_SIZE = 20;

export default function SuperadminHistory() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionFilter, setActionFilter] = useState<string>("");
  const [tenantFilter, setTenantFilter] = useState<string>("");
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    api
      .get<{ tenants: { id: string; company_name: string }[] }>("/api/superadmin/tenants?page=1&page_size=500")
      .then((r) => setTenants(r.tenants?.map((t) => ({ id: t.id, company_name: t.company_name })) || []))
      .catch(() => setTenants([]));
  }, []);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set("skip", String(page * PAGE_SIZE));
    params.set("limit", String(PAGE_SIZE));
    if (actionFilter) params.set("action", actionFilter);
    if (tenantFilter) params.set("tenant_id", tenantFilter);
    api
      .get<{ entries: LogEntry[]; total: number }>(`/api/superadmin/history?${params.toString()}`)
      .then((data) => {
        setEntries(data.entries || []);
        setTotal(data.total ?? 0);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load history"))
      .finally(() => setLoading(false));
  }, [actionFilter, tenantFilter, page]);

  const handleDownloadReport = () => {
    setExporting(true);
    setError(null);
    const params = new URLSearchParams();
    if (actionFilter) params.set("action", actionFilter);
    if (tenantFilter) params.set("tenant_id", tenantFilter);
    const url = `/api/superadmin/history/export${params.toString() ? `?${params.toString()}` : ""}`;
    downloadFile(url, "superadmin-history.csv", true)
      .catch(() => setError("Failed to download report"))
      .finally(() => setExporting(false));
  };

  return (
    <div className="container app-page">
      <div className="page-header page-header-actions">
        <h1>History (All Tenants)</h1>
        <div className="page-actions">
          <select
            value={actionFilter}
            onChange={(e) => {
              setActionFilter(e.target.value);
              setPage(0);
            }}
            style={{ width: "auto", padding: "0.35rem 0.5rem" }}
          >
            <option value="">All actions</option>
            {Object.entries(ACTION_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select
            value={tenantFilter}
            onChange={(e) => {
              setTenantFilter(e.target.value);
              setPage(0);
            }}
            style={{ width: "auto", minWidth: "140px", padding: "0.35rem 0.5rem" }}
          >
            <option value="">All tenants</option>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.company_name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn-primary"
            onClick={handleDownloadReport}
            disabled={exporting}
          >
            {exporting ? "Downloading…" : "Download report"}
          </button>
        </div>
      </div>
      <p className="app-page-desc">
        System log for all tenants: server created/deleted, access granted/revoked, users created/deleted, logins.
      </p>
      {error && <p className="error-msg">{error}</p>}
      {loading ? (
        <Spinner />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Action</th>
                <th>Tenant</th>
                <th>By</th>
                <th>IP</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-muted" style={{ padding: "1.5rem" }}>
                    No log entries yet.
                  </td>
                </tr>
              ) : (
                entries.map((e) => (
                  <tr key={e.id}>
                    <td className="text-muted text-sm" style={{ whiteSpace: "nowrap" }}>
                      {e.created_at ? new Date(e.created_at).toLocaleString() : "—"}
                    </td>
                    <td>
                      <span className="badge">{ACTION_LABELS[e.action] || e.action}</span>
                    </td>
                    <td className="text-muted">{e.tenant_name || "—"}</td>
                    <td className="text-muted">{e.username || "—"}</td>
                    <td className="text-sm">{e.ip_address || "—"}</td>
                    <td className="text-sm">{e.details || "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
      {!loading && total > 0 && (
        <div
          className="table-pagination"
          style={{ marginTop: "1rem", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}
        >
          <span className="table-meta">
            Page {page + 1} of {Math.ceil(total / PAGE_SIZE) || 1} ({total} records)
          </span>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button
              type="button"
              className="btn-outline"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </button>
            <button
              type="button"
              className="btn-outline"
              disabled={page >= Math.ceil(total / PAGE_SIZE) - 1}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
