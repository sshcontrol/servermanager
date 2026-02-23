import { useState, useEffect } from "react";
import { api } from "../api/client";

type Permission = { id: string; name: string; resource: string; action: string; description: string | null };
type RoleRow = { id: string; name: string; description: string | null; permissions: Permission[] };

export default function AdminRoles() {
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError("");
      try {
        const res = await api.get<RoleRow[]>("/api/roles");
        setRoles(res);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load roles");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="container app-page">
      <div className="page-header">
        <h1>Roles</h1>
      </div>
      {error && <p className="error-msg">{error}</p>}
      {loading ? (
        <p style={{ color: "var(--text-muted)" }}>Loading…</p>
      ) : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Description</th>
                <th>Permissions</th>
              </tr>
            </thead>
            <tbody>
              {roles.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td>{r.description || "—"}</td>
                  <td>{r.permissions.map((p) => p.name).join(", ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
