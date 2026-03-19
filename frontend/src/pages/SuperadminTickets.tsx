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
  user_id: string;
  user_name: string | null;
  user_email: string | null;
  tenant_id: string | null;
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

const STATUSES = ["open", "in_progress", "resolved", "closed"];
const CATEGORIES = ["general", "bug", "feature", "recommendation", "billing", "security"];

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

export default function SuperadminTickets() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [statusFilter, setStatusFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");

  const [view, setView] = useState<"list" | "detail">("list");
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [msgLoading, setMsgLoading] = useState(false);

  const [reply, setReply] = useState("");
  const [replying, setReplying] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const fetchTickets = () => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set("skip", String(page * PAGE_SIZE));
    params.set("limit", String(PAGE_SIZE));
    if (statusFilter) params.set("status", statusFilter);
    if (categoryFilter) params.set("category", categoryFilter);
    api
      .get<{ tickets: Ticket[]; total: number }>(`/api/tickets/admin/all?${params}`)
      .then((data) => {
        setTickets(data.tickets || []);
        setTotal(data.total ?? 0);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load tickets"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (view === "list") fetchTickets();
  }, [page, statusFilter, categoryFilter, view]);

  const openDetail = (ticket: Ticket) => {
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

  const handleStatusChange = async (newStatus: string) => {
    if (!selectedTicket) return;
    setStatusUpdating(true);
    try {
      const data = await api.patch<{ ticket: Ticket }>(`/api/tickets/${selectedTicket.id}/status`, {
        status: newStatus,
      });
      setSelectedTicket(data.ticket);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update status");
    } finally {
      setStatusUpdating(false);
    }
  };

  // Count by status for overview
  const openCount = tickets.filter((t) => t.status === "open").length;
  const inProgressCount = tickets.filter((t) => t.status === "in_progress").length;

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
            Back to All Tickets
          </button>
        </div>

        <div className="tk-detail-info">
          <div className="tk-detail-meta">
            <div className="tk-meta-item">
              <span className="tk-meta-label">Subject</span>
              <span className="tk-meta-value">{selectedTicket.subject}</span>
            </div>
            <div className="tk-meta-item">
              <span className="tk-meta-label">Submitted By</span>
              <span className="tk-meta-value">{selectedTicket.user_name || "—"}</span>
              {selectedTicket.user_email && (
                <span className="tk-meta-date">{selectedTicket.user_email}</span>
              )}
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
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span className="tk-badge" style={{ background: st.bg, color: st.color }}>
                  {statusLabel(selectedTicket.status)}
                </span>
                <select
                  value={selectedTicket.status}
                  onChange={(e) => handleStatusChange(e.target.value)}
                  disabled={statusUpdating}
                  style={{ padding: "0.2rem 0.4rem", fontSize: "0.78rem", width: "auto" }}
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>{statusLabel(s)}</option>
                  ))}
                </select>
              </div>
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
            {selectedTicket.closed_at && (
              <div className="tk-meta-item">
                <span className="tk-meta-label">Closed At</span>
                <span className="tk-meta-value tk-meta-date">{formatDate(selectedTicket.closed_at)}</span>
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
                      {m.is_staff_reply ? "Support Team" : (m.user_name || "User")}
                    </span>
                    <span className="tk-msg-time">{formatDate(m.created_at)}</span>
                  </div>
                  <div className="tk-msg-body">{m.message}</div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}

          <div className="tk-reply-box">
            <textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder="Type your reply to the user..."
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
        </div>
      </div>
    );
  }

  // ─── List view ──────────────────────────────────────────────────────
  return (
    <div className="container app-page">
      <div className="page-header page-header-actions">
        <h1>Support Tickets</h1>
        <div className="page-actions">
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}
            style={{ width: "auto", padding: "0.35rem 0.5rem" }}
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{statusLabel(s)}</option>
            ))}
          </select>
          <select
            value={categoryFilter}
            onChange={(e) => { setCategoryFilter(e.target.value); setPage(0); }}
            style={{ width: "auto", padding: "0.35rem 0.5rem" }}
          >
            <option value="">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c} style={{ textTransform: "capitalize" }}>{c}</option>
            ))}
          </select>
        </div>
      </div>
      <p className="app-page-desc">
        Manage support tickets from all users. {!statusFilter && (<>
          <strong style={{ color: "#60a5fa" }}>{openCount} open</strong>{" · "}
          <strong style={{ color: "#fbbf24" }}>{inProgressCount} in progress</strong>{" · "}
          <strong>{total} total</strong>
        </>)}
      </p>

      {error && <p className="error-msg">{error}</p>}

      {loading ? (
        <Spinner />
      ) : tickets.length === 0 ? (
        <div className="tk-empty">
          <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          <p>No tickets found.</p>
        </div>
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Subject</th>
                  <th>From</th>
                  <th>Category</th>
                  <th>Priority</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {tickets.map((t) => {
                  const st = STATUS_STYLES[t.status] || STATUS_STYLES.open;
                  const pr = PRIORITY_STYLES[t.priority] || PRIORITY_STYLES.medium;
                  return (
                    <tr key={t.id} style={{ cursor: "pointer" }} onClick={() => openDetail(t)}>
                      <td className="text-muted" style={{ fontFamily: "monospace", fontWeight: 700 }}>
                        {t.ticket_number}
                      </td>
                      <td style={{ fontWeight: 600, color: "#e2e8f0", maxWidth: "250px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {t.subject}
                      </td>
                      <td className="text-muted text-sm">
                        <div>{t.user_name || "—"}</div>
                        {t.user_email && <div style={{ fontSize: "0.72rem", opacity: 0.7 }}>{t.user_email}</div>}
                      </td>
                      <td>
                        <span className="tk-badge tk-badge-sm" style={{ background: "rgba(139,92,246,0.12)", color: "#a78bfa" }}>
                          {t.category}
                        </span>
                      </td>
                      <td>
                        <span className="tk-badge tk-badge-sm" style={{ background: pr.bg, color: pr.color }}>
                          {t.priority}
                        </span>
                      </td>
                      <td>
                        <span className="tk-badge" style={{ background: st.bg, color: st.color }}>
                          {statusLabel(t.status)}
                        </span>
                      </td>
                      <td className="text-muted text-sm" style={{ whiteSpace: "nowrap" }}>
                        {formatDate(t.created_at)}
                      </td>
                      <td className="text-muted text-sm" style={{ whiteSpace: "nowrap" }}>
                        {formatDate(t.updated_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
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
