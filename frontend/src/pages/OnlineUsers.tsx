import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import Spinner from "../components/Spinner";

type ServerItem = { id: string; hostname: string; friendly_name: string | null };
type OnlineUser = {
  user_id: string;
  username: string;
  email: string;
  last_seen_at: string | null;
  servers: ServerItem[];
  connected_to: ServerItem[];
};
type OnlineResponse = { count: number; users: OnlineUser[] };

function formatLastSeen(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const now = new Date();
  const sec = Math.floor((now.getTime() - d.getTime()) / 1000);
  if (sec < 60) return "Just now";
  if (sec < 3600) return `${Math.floor(sec / 60)} min ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} h ago`;
  return d.toLocaleString();
}

export default function OnlineUsers() {
  const [data, setData] = useState<OnlineResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    api
      .get<OnlineResponse>("/api/users/online")
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="container app-page">
      <div className="page-header">
        <h1>User monitor</h1>
      </div>
      <p className="app-page-desc">
        Users with an active panel session in the last 5 minutes. &quot;Connected to&quot; shows only servers where they have an active SSH session (reported by each server every 2 min).
      </p>
      {error && <p className="error-msg">{error}</p>}
      {loading && !data ? (
        <Spinner />
      ) : data ? (
        <>
          <div className="card mb-3">
            <h2 className="card-subtitle" style={{ marginBottom: "0.25rem" }}>Online users</h2>
            <p style={{ fontSize: "1.5rem", fontWeight: 600, color: "var(--primary)", margin: 0 }}>
              {data.count}
            </p>
            <p className="text-muted mt-1 mb-0">Active panel sessions (last 5 min)</p>
          </div>

          {data.users.length === 0 ? (
            <p className="text-muted">No users with recent activity.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Last seen</th>
                    <th>Connected to</th>
                  </tr>
                </thead>
                <tbody>
                  {data.users.map((u) => (
                    <tr key={u.user_id}>
                      <td style={{ verticalAlign: "top" }}>
                        <div>
                          <strong>{u.username}</strong>
                          <div className="text-muted text-sm">{u.email}</div>
                        </div>
                      </td>
                      <td style={{ verticalAlign: "top" }}>
                        {formatLastSeen(u.last_seen_at)}
                      </td>
                      <td style={{ verticalAlign: "top" }}>
                        {(u.connected_to?.length ?? 0) === 0 ? (
                          <span className="text-muted">None</span>
                        ) : (
                          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                            {(u.connected_to ?? []).map((s) => (
                              <li key={s.id} style={{ marginBottom: "0.25rem" }}>
                                <Link to={`/server/${s.id}`}>{s.friendly_name || s.hostname}</Link>
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
