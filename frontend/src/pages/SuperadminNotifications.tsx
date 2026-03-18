import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import Toggle from "../components/Toggle";

type Recipient = {
  id: string;
  username: string;
  email: string;
  full_name: string | null;
  company_name: string;
};

export default function SuperadminNotifications() {
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [adminsOnly, setAdminsOnly] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [notificationType, setNotificationType] = useState<"announcement" | "payment_reminder" | "system">("announcement");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  const fetchRecipients = async () => {
    setLoading(true);
    try {
      const res = await api.get<Recipient[]>(
        `/api/superadmin/notifications/recipients?admins_only=${adminsOnly}`
      );
      setRecipients(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRecipients();
  }, [adminsOnly]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedIds.size === recipients.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(recipients.map((r) => r.id)));
    }
  };

  const sendNotification = async () => {
    if (selectedIds.size === 0) {
      setError("Select at least one recipient");
      return;
    }
    if (!message.trim()) {
      setError("Message is required");
      return;
    }
    setSending(true);
    setError("");
    setMsg("");
    try {
      const res = await api.post<{ message: string; count: number }>("/api/superadmin/notifications/send", {
        recipient_ids: Array.from(selectedIds),
        subject: subject.trim() || undefined,
        message: message.trim(),
        notification_type: notificationType,
      });
      setMsg(`Message has been sent to ${res.count} recipient(s).`);
      setSubject("");
      setMessage("");
      setSelectedIds(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="container app-page">
      <div className="page-header">
        <Link to="/superadmin/tenants" className="btn-link">← Superadmin</Link>
        <h1 style={{ marginTop: "0.5rem" }}>Send Notification</h1>
        <p style={{ color: "var(--text-muted)", fontSize: "0.95rem", marginTop: "0.25rem" }}>
          Send messages to admins or users. Use for announcements, payment reminders, or system updates.
        </p>
      </div>

      <div className="card" style={{ maxWidth: 600, marginBottom: "1.5rem" }}>
        <h2 className="card-subtitle">Compose</h2>
        <div className="form-group">
          <label>Type</label>
          <select
            value={notificationType}
            onChange={(e) => setNotificationType(e.target.value as "announcement" | "payment_reminder" | "system")}
          >
            <option value="announcement">Announcement</option>
            <option value="payment_reminder">Payment reminder</option>
            <option value="system">System</option>
          </select>
        </div>
        <div className="form-group">
          <label>Subject (optional)</label>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="e.g. Upcoming payment due"
          />
        </div>
        <div className="form-group">
          <label>Message</label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Your message here..."
            rows={4}
            style={{ resize: "vertical", minHeight: 100 }}
          />
        </div>
      </div>

      <div className="card" style={{ maxWidth: 600 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
          <h2 className="card-subtitle" style={{ margin: 0 }}>Recipients</h2>
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", margin: 0 }}>
            <Toggle checked={adminsOnly} onChange={setAdminsOnly} />
            <span style={{ fontSize: "0.9rem" }}>Admins only</span>
          </label>
        </div>

        {loading ? (
          <p style={{ color: "var(--text-muted)" }}>Loading...</p>
        ) : recipients.length === 0 ? (
          <p style={{ color: "var(--text-muted)" }}>No recipients found.</p>
        ) : (
          <>
            <button
              type="button"
              className="secondary"
              onClick={selectAll}
              style={{ marginBottom: "0.75rem", fontSize: "0.85rem" }}
            >
              {selectedIds.size === recipients.length ? "Deselect all" : "Select all"}
            </button>
            <div
              style={{
                maxHeight: 280,
                overflowY: "auto",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: "0.5rem",
              }}
            >
              {recipients.map((r) => (
                <label
                  key={r.id}
                  className="notification-recipient-row"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.75rem",
                    padding: "0.5rem 0.75rem",
                    borderRadius: 6,
                    cursor: "pointer",
                    background: selectedIds.has(r.id) ? "rgba(64, 224, 208, 0.1)" : "transparent",
                  }}
                >
                  <Toggle checked={selectedIds.has(r.id)} onChange={() => toggleSelect(r.id)} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, color: "var(--text)" }}>
                      {r.full_name || r.username}
                    </div>
                    <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                      {r.company_name} • {r.email}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </>
        )}
      </div>

      {msg && <p style={{ color: "var(--accent)", marginTop: "1rem" }}>{msg}</p>}
      {error && <p className="error-msg" style={{ marginTop: "1rem" }}>{error}</p>}

      <div style={{ marginTop: "1.5rem" }}>
        <button
          className="primary"
          onClick={sendNotification}
          disabled={sending || selectedIds.size === 0 || !message.trim()}
        >
          {sending ? "Sending..." : `Send to ${selectedIds.size} recipient(s)`}
        </button>
      </div>
    </div>
  );
}
