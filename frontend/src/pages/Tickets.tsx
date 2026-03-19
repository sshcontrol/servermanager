import { useState, useEffect, useRef } from "react";
import { api } from "../api/client";
import Spinner from "../components/Spinner";
import "./Tickets.css";

type Ticket = {
  id: string;
  ticket_number: number;
  subject: string;
  category: string;
  priority: string;
  status: string;
  user_name: string | null;
  created_at: string | null;
  updated_at: string | null;
  closed_at: string | null;
};

type Message = {
  id: string;
  user_name: string | null;
  message: string;
  is_staff_reply: boolean;
  created_at: string | null;
};

const CATEGORIES = [
  { value: "general", label: "General" },
  { value: "bug", label: "Bug Report" },
  { value: "feature", label: "Feature Request" },
  { value: "recommendation", label: "Recommendation" },
  { value: "billing", label: "Billing" },
  { value: "security", label: "Security" },
];

const PRIORITIES = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "critical", label: "Critical" },
];

const STATUS_STYLES: Record<string, { bg: string; color: string }> = {
  open: { bg: "rgba(59,130,246,0.15)", color: "#60a5fa" },
  in_progress: { bg: "rgba(251,191,36,0.15)", color: "#fbbf24" },
  resolved: { bg: "rgba(45,212,191,0.15)", color: "#2dd4bf" },
  closed: { bg: "rgba(148,163,184,0.15)", color: "#94a3b8" },
};

const PRIORITY_STYLES: Record<string, { bg: string; color: string }> = {
  low: { bg: "rgba(148,163,184,0.15)", color: "#94a3b8" },
  medium: { bg: "rgba(59,130,246,0.15)", color: "#60a5fa" },
  high: { bg: "rgba(251,191,36,0.15)", color: "#fbbf24" },
  critical: { bg: "rgba(239,68,68,0.15)", color: "#ef4444" },
};

const PAGE_SIZE = 20;

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

function statusLabel(s: string) {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function Tickets() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [view, setView] = useState<"list" | "create" | "detail">("list");
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [msgLoading, setMsgLoading] = useState(false);

  // Create form
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState("general");
  const [priority, setPriority] = useState("medium");
  const [message, setMessage] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  // Reply
  const [reply, setReply] = useState("");
  const [replying, setReplying] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const fetchTickets = () => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set("skip", String(page * PAGE_SIZE));
    params.set("limit", String(PAGE_SIZE));
    api
      .get<{ tickets: Ticket[]; total: number }>(`/api/tickets?${params}`)
      .then((data) => {
        setTickets(data.tickets || []);
        setTotal(data.total ?? 0);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load tickets"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (view === "list") fetchTickets();
  }, [page, view]);

  const openTicketDetail = (ticket: Ticket) => {
    setSelectedTicket(ticket);
    setView("detail");
    setMsgLoading(true);
    api
      .get<{ ticket: Ticket; messages: Message[] }>(`/api/tickets/${ticket.id}`)
      .then((data) => {
        setSelectedTicket(data.ticket);
        setMessages(data.messages || []);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load ticket"))
      .finally(() => setMsgLoading(false));
  };

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError("");
    setCreating(true);
    try {
      await api.post("/api/tickets", { subject, category, priority, message });
      setSubject("");
      setCategory("general");
      setPriority("medium");
      setMessage("");
      setView("list");
      setPage(0);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create ticket");
    } finally {
      setCreating(false);
    }
  };

  const handleReply = async () => {
    if (!reply.trim() || !selectedTicket) return;
    setReplying(true);
    try {
      const data = await api.post<{ reply: Message }>(`/api/tickets/${selectedTicket.id}/reply`, {
        message: reply,
      });
      setMessages((prev) => [...prev, data.reply]);
      setReply("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send reply");
    } finally {
      setReplying(false);
    }
  };

  // ─── Create view ────────────────────────────────────────────────────
  if (view === "create") {
    return (
      <div className="container app-page">
        <div className="page-header">
          <h1>Create New Ticket</h1>
        </div>
        <p className="app-page-desc">Describe your issue and our support team will get back to you as soon as possible.</p>

        <form className="tk-create-form" onSubmit={handleCreate}>
          <div className="tk-form-row">
            <div className="tk-form-field">
              <label htmlFor="tk-subject">Subject *</label>
              <input
                id="tk-subject"
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Brief description of your issue"
                required
                minLength={3}
                maxLength={255}
              />
            </div>
          </div>
          <div className="tk-form-row tk-form-row-2">
            <div className="tk-form-field">
              <label htmlFor="tk-category">Category</label>
              <select id="tk-category" value={category} onChange={(e) => setCategory(e.target.value)}>
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <div className="tk-form-field">
              <label htmlFor="tk-priority">Priority</label>
              <select id="tk-priority" value={priority} onChange={(e) => setPriority(e.target.value)}>
                {PRIORITIES.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="tk-form-field">
            <label htmlFor="tk-message">Message *</label>
            <textarea
              id="tk-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Describe your issue in detail. Include steps to reproduce if reporting a bug."
              required
              minLength={10}
              rows={8}
            />
          </div>

          {createError && <p className="error-msg">{createError}</p>}

          <div className="tk-form-actions">
            <button type="button" className="btn-outline" onClick={() => setView("list")}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={creating}>
              {creating ? "Submitting…" : "Submit Ticket"}
            </button>
          </div>
        </form>
      </div>
    );
  }

  // ─── Detail view ────────────────────────────────────────────────────
  if (view === "detail" && selectedTicket) {
    const st = STATUS_STYLES[selectedTicket.status] || STATUS_STYLES.open;
    const pr = PRIORITY_STYLES[selectedTicket.priority] || PRIORITY_STYLES.medium;
    return (
      <div className="container app-page">
        <div className="page-header page-header-actions">
          <h1>Ticket #{selectedTicket.ticket_number}</h1>
          <button type="button" className="btn-outline" onClick={() => setView("list")}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5"/><polyline points="12 19 5 12 12 5"/></svg>
            Back to Tickets
          </button>
        </div>

        <div className="tk-detail-info">
          <div className="tk-detail-meta">
            <div className="tk-meta-item">
              <span className="tk-meta-label">Subject</span>
              <span className="tk-meta-value">{selectedTicket.subject}</span>
            </div>
            <div className="tk-meta-item">
              <span className="tk-meta-label">Category</span>
              <span className="tk-badge" style={{ background: "rgba(139,92,246,0.15)", color: "#a78bfa" }}>
                {selectedTicket.category}
              </span>
            </div>
            <div className="tk-meta-item">
              <span className="tk-meta-label">Priority</span>
              <span className="tk-badge" style={{ background: pr.bg, color: pr.color }}>
                {selectedTicket.priority}
              </span>
            </div>
            <div className="tk-meta-item">
              <span className="tk-meta-label">Status</span>
              <span className="tk-badge" style={{ background: st.bg, color: st.color }}>
                {statusLabel(selectedTicket.status)}
              </span>
            </div>
            <div className="tk-meta-item">
              <span className="tk-meta-label">Created</span>
              <span className="tk-meta-value tk-meta-date">{formatDate(selectedTicket.created_at)}</span>
            </div>
            {selectedTicket.updated_at && (
              <div className="tk-meta-item">
                <span className="tk-meta-label">Last Update</span>
                <span className="tk-meta-value tk-meta-date">{formatDate(selectedTicket.updated_at)}</span>
              </div>
            )}
          </div>
        </div>

        {error && <p className="error-msg">{error}</p>}

        <div className="tk-messages">
          <h3 className="tk-messages-title">Conversation</h3>
          {msgLoading ? (
            <Spinner />
          ) : (
            <div className="tk-message-list">
              {messages.map((m) => (
                <div key={m.id} className={`tk-msg ${m.is_staff_reply ? "tk-msg-staff" : "tk-msg-user"}`}>
                  <div className="tk-msg-header">
                    <span className="tk-msg-author">
                      {m.is_staff_reply && (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                      )}
                      {m.is_staff_reply ? "Support Team" : (m.user_name || "You")}
                    </span>
                    <span className="tk-msg-time">{formatDate(m.created_at)}</span>
                  </div>
                  <div className="tk-msg-body">{m.message}</div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}

          {selectedTicket.status !== "closed" && (
            <div className="tk-reply-box">
              <textarea
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder="Type your reply..."
                rows={4}
              />
              <button
                type="button"
                className="btn-primary"
                onClick={handleReply}
                disabled={replying || !reply.trim()}
              >
                {replying ? "Sending…" : "Send Reply"}
              </button>
            </div>
          )}
          {selectedTicket.status === "closed" && (
            <p className="tk-closed-notice">This ticket has been closed. If you need further assistance, please open a new ticket.</p>
          )}
        </div>
      </div>
    );
  }

  // ─── List view ──────────────────────────────────────────────────────
  return (
    <div className="container app-page">
      <div className="page-header page-header-actions">
        <h1>Support Tickets</h1>
        <button type="button" className="btn-primary" onClick={() => setView("create")}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          New Ticket
        </button>
      </div>
      <p className="app-page-desc">
        Submit and track your support requests. Our team typically responds within 24 hours.
      </p>

      {error && <p className="error-msg">{error}</p>}

      {loading ? (
        <Spinner />
      ) : tickets.length === 0 ? (
        <div className="tk-empty">
          <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          <p>No tickets yet.</p>
          <button type="button" className="btn-primary" onClick={() => setView("create")}>Create Your First Ticket</button>
        </div>
      ) : (
        <>
          <div className="tk-ticket-list">
            {tickets.map((t) => {
              const st = STATUS_STYLES[t.status] || STATUS_STYLES.open;
              const pr = PRIORITY_STYLES[t.priority] || PRIORITY_STYLES.medium;
              return (
                <div key={t.id} className="tk-ticket-card" onClick={() => openTicketDetail(t)}>
                  <div className="tk-ticket-card-top">
                    <span className="tk-ticket-num">#{t.ticket_number}</span>
                    <span className="tk-badge" style={{ background: st.bg, color: st.color }}>
                      {statusLabel(t.status)}
                    </span>
                  </div>
                  <h3 className="tk-ticket-subject">{t.subject}</h3>
                  <div className="tk-ticket-card-bottom">
                    <span className="tk-badge tk-badge-sm" style={{ background: "rgba(139,92,246,0.12)", color: "#a78bfa" }}>
                      {t.category}
                    </span>
                    <span className="tk-badge tk-badge-sm" style={{ background: pr.bg, color: pr.color }}>
                      {t.priority}
                    </span>
                    <span className="tk-ticket-date">{formatDate(t.created_at)}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {total > PAGE_SIZE && (
            <div className="table-pagination" style={{ marginTop: "1rem", alignItems: "center", gap: "1rem" }}>
              <span className="table-meta">
                Page {page + 1} of {Math.ceil(total / PAGE_SIZE)} ({total} tickets)
              </span>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button type="button" className="btn-outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</button>
                <button type="button" className="btn-outline" disabled={page >= Math.ceil(total / PAGE_SIZE) - 1} onClick={() => setPage((p) => p + 1)}>Next</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
