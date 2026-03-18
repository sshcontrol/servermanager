import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../contexts/AuthContext";
import Spinner from "../components/Spinner";

type ServerItemFromGroups = {
  id: string;
  hostname: string;
  friendly_name: string | null;
  ip_address: string | null;
  source: string;
  source_name: string | null;
};

type ServerItemFromApi = {
  id: string;
  hostname: string;
  friendly_name: string | null;
  ip_address: string | null;
  description: string | null;
  status: string;
  created_at: string;
  server_groups?: { id: string; name: string }[];
};

type MyGroups = {
  user_groups: { id: string; name: string }[];
  server_groups: { id: string; name: string; role: string }[];
  servers: ServerItemFromGroups[];
};

export default function ServerAccess() {
  const { user, isAdmin } = useAuth();
  const [groupsData, setGroupsData] = useState<MyGroups | null>(null);
  const [serversData, setServersData] = useState<ServerItemFromApi[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const linuxUsername = (user?.username || "root").toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/^_+|_+$/g, "") || "user";

  useEffect(() => {
    if (isAdmin) {
      api
        .get<ServerItemFromApi[]>("/api/servers")
        .then((data) => setServersData(Array.isArray(data) ? data : []))
        .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
        .finally(() => setLoading(false));
    } else {
      api
        .get<MyGroups>("/api/users/me/groups")
        .then(setGroupsData)
        .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
        .finally(() => setLoading(false));
    }
  }, [isAdmin]);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  if (loading) return <div className="container app-page"><Spinner /></div>;
  if (error) return <div className="container app-page"><p className="error-msg">{error}</p></div>;

  if (isAdmin) {
    const filtered = serversData.filter((s) => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        (s.hostname || "").toLowerCase().includes(q) ||
        (s.friendly_name || "").toLowerCase().includes(q) ||
        (s.ip_address || "").toLowerCase().includes(q)
      );
    });
    return (
      <div className="container app-page">
        <div className="page-header page-header-actions">
          <div>
            <Link to="/" className="btn-link">← Dashboard</Link>
            <h1 style={{ marginTop: "0.5rem" }}>Server access</h1>
          </div>
          {serversData.length > 0 && (
            <input
              type="text"
              placeholder="Search servers…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: 220, padding: "0.4rem 0.7rem", fontSize: "0.9rem" }}
            />
          )}
        </div>

        {filtered.length > 0 ? (
          <div className="card" style={{ marginBottom: "1.5rem" }}>
            <h2 className="card-subtitle">Connect to your servers</h2>
            <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginBottom: "1rem" }}>
              You have one key for all servers. Add your SSH key in <Link to="/keys">Key</Link> if needed. Use the same PPK or PEM for every server—only the host changes.
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Server</th>
                    <th>Groups</th>
                    <th>Host</th>
                    <th>Connect</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((s) => {
                    const sshHost = s.ip_address || s.hostname;
                    const sshCmd = `ssh ${linuxUsername}@${sshHost}`;
                    return (
                      <tr key={s.id}>
                        <td>
                          <span>{s.friendly_name || s.hostname}</span>
                        </td>
                        <td>
                          {(s.server_groups?.length ?? 0) > 0 ? (
                            <span style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem" }}>
                              {s.server_groups!.map((g) => (
                                <Link key={g.id} to={`/server-groups/${g.id}`} className="badge badge-info" style={{ textDecoration: "none" }}>
                                  {g.name}
                                </Link>
                              ))}
                            </span>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td className="text-muted text-sm">{sshHost}</td>
                        <td>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
                            <code style={{ padding: "0.25rem 0.4rem", background: "var(--bg-subtle)", borderRadius: 4, fontSize: "0.85rem" }}>{sshCmd}</code>
                            <button
                              type="button"
                              className="btn-sm"
                              onClick={() => copyToClipboard(sshCmd, `cmd-${s.id}`)}
                            >
                              {copiedId === `cmd-${s.id}` ? "Copied!" : "Copy"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "1rem", marginBottom: 0 }}>
              Download your key: <Link to="/keys">Key</Link> → Download PEM or PPK. PuTTY: Host = host above, Port 22, Auto-login username = <strong>{linuxUsername}</strong>, Auth → Private key file = your .ppk.
            </p>
          </div>
        ) : (
          <div className="card" style={{ padding: "2rem", textAlign: "center" }}>
            <p style={{ color: "var(--text-muted)", marginBottom: 0 }}>
              {serversData.length === 0
                ? <>There is no server to show. Add a server from <Link to="/server/add">Add server</Link>.</>
                : "No servers match your search."}
            </p>
          </div>
        )}
      </div>
    );
  }

  const servers = groupsData?.servers ?? [];
  const filteredUser = servers.filter((s) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (s.hostname || "").toLowerCase().includes(q) ||
      (s.friendly_name || "").toLowerCase().includes(q) ||
      (s.ip_address || "").toLowerCase().includes(q)
    );
  });
  return (
    <div className="container app-page">
      <div className="page-header page-header-actions">
        <div>
          <Link to="/" className="btn-link">← Dashboard</Link>
          <h1 style={{ marginTop: "0.5rem" }}>Server access</h1>
        </div>
        {servers.length > 0 && (
          <input
            type="text"
            placeholder="Search servers…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 220, padding: "0.4rem 0.7rem", fontSize: "0.9rem" }}
          />
        )}
      </div>

      {filteredUser.length > 0 ? (
        <div className="card" style={{ marginBottom: "1.5rem" }}>
          <h2 className="card-subtitle">Connect to your servers</h2>
          <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginBottom: "1rem" }}>
            You have one key for all servers. Add your SSH key in <Link to="/keys">Key</Link> if needed. Use the same PPK or PEM for every server—only the host changes.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Server</th>
                  <th>Host</th>
                  <th>Connect</th>
                </tr>
              </thead>
                <tbody>
                {filteredUser.map((s) => {
                  const sshHost = s.ip_address || s.hostname;
                  const sshCmd = `ssh ${linuxUsername}@${sshHost}`;
                  return (
                    <tr key={s.id}>
                      <td>
                        <span>{s.friendly_name || s.hostname}</span>
                      </td>
                      <td className="text-muted text-sm">{sshHost}</td>
                      <td>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
                          <code style={{ padding: "0.25rem 0.4rem", background: "var(--bg-subtle)", borderRadius: 4, fontSize: "0.85rem" }}>{sshCmd}</code>
                          <button
                            type="button"
                            className="btn-sm"
                            onClick={() => copyToClipboard(sshCmd, `cmd-${s.id}`)}
                          >
                            {copiedId === `cmd-${s.id}` ? "Copied!" : "Copy"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "1rem", marginBottom: 0 }}>
            Download your key: <Link to="/keys">Key</Link> → Download PEM or PPK. PuTTY: Host = host above, Port 22, Auto-login username = <strong>{linuxUsername}</strong>, Auth → Private key file = your .ppk.
          </p>
        </div>
      ) : (
        <div className="card" style={{ padding: "2rem", textAlign: "center" }}>
          <p style={{ color: "var(--text-muted)", marginBottom: 0 }}>
            {servers.length === 0
              ? "No servers assigned yet. Ask your admin to grant you access."
              : "No servers match your search."}
          </p>
        </div>
      )}
    </div>
  );
}
