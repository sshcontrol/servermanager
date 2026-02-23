import { useState, useEffect } from "react";
import { api } from "../api/client";
import Spinner from "../components/Spinner";

type LogEntry = {
  id: string;
  created_at: string;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  user_id: string | null;
  username: string | null;
  details: string | null;
};

const ACTION_LABELS: Record<string, string> = {
  server_registered: "Server created",
  server_deleted: "Server deleted",
  access_granted: "Access granted",
  access_revoked: "Access revoked",
  user_created: "User created",
  user_deleted: "User deleted",
  user_login: "User login",
};

const PAGE_SIZE = 20;

export default function History() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("");

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set("skip", String(page * PAGE_SIZE));
    params.set("limit", String(PAGE_SIZE));
    if (filter) params.set("action", filter);
    api
      .get<{ entries: LogEntry[]; total: number }>(`/api/history?${params.toString()}`)
      .then((data) => {
        setEntries(data.entries || []);
        setTotal(data.total ?? 0);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load history"))
      .finally(() => setLoading(false));
  }, [filter, page]);

  return (
    <div className="container app-page">
      <div className="page-header page-header-actions">
        <h1>History</h1>
        <select
          value={filter}
          onChange={(e) => { setFilter(e.target.value); setPage(0); }}
          style={{ width: "auto", padding: "0.35rem 0.5rem" }}
        >
          <option value="">All actions</option>
          {Object.entries(ACTION_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>
      <p className="app-page-desc">
        System log: server created or deleted, access granted or revoked, users created or deleted.
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
                <th>By</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-muted" style={{ padding: "1.5rem" }}>
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
                    <td className="text-muted">{e.username || "—"}</td>
                    <td className="text-sm">{e.details || "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
      {!loading && total > 0 && (
        <div className="table-pagination" style={{ marginTop: "1rem", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
          <span className="table-meta">
            Page {page + 1} of {Math.ceil(total / PAGE_SIZE) || 1} ({total} records)
          </span>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button type="button" className="btn-outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</button>
            <button type="button" className="btn-outline" disabled={page >= Math.ceil(total / PAGE_SIZE) - 1} onClick={() => setPage((p) => p + 1)}>Next</button>
          </div>
        </div>
      )}
    </div>
  );
}
