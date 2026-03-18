import { useState, useEffect, useRef } from "react";
import { api } from "../api/client";

type NotificationItem = {
  id: string;
  subject: string | null;
  message: string;
  notification_type: string;
  created_at: string | null;
  read_at: string | null;
  sender_name: string;
};

export default function NotificationDropdown() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const prevUnreadRef = useRef<number | null>(null);

  const fetchNotifications = async () => {
    try {
      const res = await api.get<{ notifications: NotificationItem[]; unread_count: number }>(
        "/api/notifications/me?limit=20"
      );
      const newUnread = res.unread_count;
      if (prevUnreadRef.current !== null && newUnread > prevUnreadRef.current) {
        window.location.reload();
        return;
      }
      prevUnreadRef.current = newUnread;
      setNotifications(res.notifications);
      setUnreadCount(newUnread);
    } catch {
      setNotifications([]);
      setUnreadCount(0);
    }
  };

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, [open]);

  const markAsRead = async (id: string) => {
    try {
      await api.patch(`/api/notifications/${id}/read`);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n))
      );
      setUnreadCount((c) => Math.max(0, c - 1));
    } catch {}
  };

  const deleteNotification = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      await api.delete(`/api/notifications/${id}`);
      setNotifications((prev) => prev.filter((n) => n.id !== id));
      setUnreadCount((c) => {
        const n = notifications.find((x) => x.id === id);
        return n && !n.read_at ? Math.max(0, c - 1) : c;
      });
    } catch {}
  };

  const markAllRead = async () => {
    setLoading(true);
    try {
      await api.post("/api/notifications/read-all");
      setNotifications((prev) => prev.map((n) => ({ ...n, read_at: n.read_at || new Date().toISOString() })));
      setUnreadCount(0);
    } catch {
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (s: string | null) => {
    if (!s) return "";
    const d = new Date(s);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 60000) return "Just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return d.toLocaleDateString();
  };

  return (
    <div className="notification-dropdown-wrap" ref={dropdownRef}>
      <button
        type="button"
        className="app-topbar-link notification-bell-btn"
        onClick={() => setOpen((o) => !o)}
        title="Notifications"
        aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ""}`}
      >
        <span className="notification-bell-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
            <path d="M13 21a2 2 0 0 1-2 2 2 2 0 0 1-2-2"/>
          </svg>
        </span>
        <span className="notification-label">Notification</span>
        {unreadCount > 0 && <span className="notification-badge">{unreadCount > 99 ? "99+" : unreadCount}</span>}
      </button>

      {open && (
        <div className="notification-dropdown">
          <div className="notification-dropdown-header">
            <h3>Notifications</h3>
            {unreadCount > 0 && (
              <button type="button" className="btn-link" onClick={markAllRead} disabled={loading}>
                Mark all read
              </button>
            )}
          </div>
          <div className="notification-dropdown-list">
            {notifications.length === 0 ? (
              <p className="notification-empty">No notifications</p>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  className={`notification-item ${n.read_at ? "" : "unread"}`}
                  onClick={() => {
                    if (!n.read_at) markAsRead(n.id);
                  }}
                >
                  <div className="notification-item-header">
                    <span className="notification-sender">{n.sender_name}</span>
                    <span className="notification-item-meta">
                      <span className="notification-time">{formatDate(n.created_at)}</span>
                      <button
                      type="button"
                      className="notification-delete-btn"
                      onClick={(e) => deleteNotification(e, n.id)}
                      title="Remove"
                      aria-label="Remove notification"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="18" y1="6" x2="6" y2="18"/>
                          <line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                      </button>
                    </span>
                  </div>
                  {n.subject && <div className="notification-subject">{n.subject}</div>}
                  <div className="notification-message">{n.message}</div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
