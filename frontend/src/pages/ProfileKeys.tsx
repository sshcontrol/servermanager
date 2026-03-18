import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { api, downloadFile } from "../api/client";
import ConfirmModal from "../components/ConfirmModal";
import Spinner from "../components/Spinner";

type ProfileKeysProps = { embedded?: boolean };

function truncateKey(key: string, head = 24, tail = 12): string {
  if (!key || key.length <= head + tail + 6) return key;
  return `${key.slice(0, head)}...${key.slice(-tail)}`;
}

function truncateFingerprint(fp: string, len = 16): string {
  if (!fp || fp.length <= len) return fp;
  return `${fp.slice(0, len)}...`;
}

export default function ProfileKeys({ embedded }: ProfileKeysProps) {
  const { user, isAdmin } = useAuth();
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [keyChangeModalOpen, setKeyChangeModalOpen] = useState(false);
  const [sshKey, setSshKey] = useState<{ has_key: boolean; public_key?: string; fingerprint?: string } | null>(null);
  const [sshKeyLoading, setSshKeyLoading] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [myKey, setMyKey] = useState<{ has_key: boolean; public_key?: string; fingerprint?: string; uses_own_key?: boolean } | null>(null);
  const [myKeyLoading, setMyKeyLoading] = useState(false);
  const [userKeyRegenerating, setUserKeyRegenerating] = useState(false);
  const [ownKeyInput, setOwnKeyInput] = useState("");
  const [savingOwnKey, setSavingOwnKey] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{ msg: string; fn: () => Promise<void> } | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  const fetchSshKey = async () => {
    if (!isAdmin) return;
    setSshKeyLoading(true);
    try {
      const data = await api.get<{ has_key: boolean; public_key?: string; fingerprint?: string }>("/api/admin/ssh-key");
      setSshKey(data);
    } catch {
      setSshKey(null);
    } finally {
      setSshKeyLoading(false);
    }
  };

  const fetchMyKey = async () => {
    setMyKeyLoading(true);
    try {
      const data = await api.get<{ has_key: boolean; public_key?: string; fingerprint?: string; uses_own_key?: boolean }>("/api/users/me/ssh-key");
      setMyKey(data);
    } catch {
      setMyKey(null);
    } finally {
      setMyKeyLoading(false);
    }
  };

  useEffect(() => {
    fetchSshKey();
  }, [isAdmin]);

  useEffect(() => {
    fetchMyKey();
  }, [user?.id]);

  const handleUploadKey = async () => {
    const line = ownKeyInput.trim().split("\n")[0];
    if (!line) return;
    setSavingOwnKey(true);
    setMessage(null);
    try {
      await api.post("/api/users/me/ssh-key/public", { public_key: line });
      setOwnKeyInput("");
      await fetchMyKey();
      setKeyChangeModalOpen(true);
    } catch (e: unknown) {
      const msg = e && typeof e === "object" && "detail" in e ? String((e as { detail: unknown }).detail) : (e instanceof Error ? e.message : "Failed to save key");
      setMessage({ type: "error", text: msg });
    } finally {
      setSavingOwnKey(false);
    }
  };

  const HelpContent = () => (
    <div style={{ fontSize: "0.95rem", lineHeight: 1.6 }}>
      <h4 style={{ marginBottom: "0.5rem" }}>How to create an SSH key</h4>
      <p><strong>Mac / Linux:</strong> Open Terminal. Run: <code>ssh-keygen -t ed25519 -C "your@email.com"</code></p>
      <p><strong>Windows:</strong> Open PowerShell. Run the same command, or use PuTTYgen to generate a key.</p>
      <h4 style={{ marginTop: "1rem", marginBottom: "0.5rem" }}>How to find your public key</h4>
      <p><strong>Mac / Linux:</strong> <code>~/.ssh/id_ed25519.pub</code> or <code>~/.ssh/id_rsa.pub</code></p>
      <p><strong>Windows:</strong> <code>%USERPROFILE%\.ssh\id_ed25519.pub</code> — open in Notepad and copy the whole line.</p>
      <h4 style={{ marginTop: "1rem", marginBottom: "0.5rem" }}>How to use your key</h4>
      <p><strong>Terminal:</strong> <code>ssh -i ~/.ssh/id_ed25519 youruser@server-ip</code></p>
      <p><strong>PuTTY:</strong> Connection → SSH → Auth → Private key file: browse to your .ppk file.</p>
    </div>
  );

  const content = (
    <>
      {!embedded && (
        <div className="page-header page-header-actions">
          <div>
            <Link to="/" className="btn-link">← Dashboard</Link>
            <h1 style={{ marginTop: "0.5rem" }}>SSH Key</h1>
            <p style={{ color: "var(--text-muted)", fontSize: "0.95rem", marginTop: "0.25rem" }}>
              {isAdmin ? "One key for all servers. Upload your own or use the system-generated key." : "Your key is used to connect to servers. Upload your own or generate one."}
            </p>
          </div>
          <button type="button" className="btn-outline" onClick={() => setHelpOpen(true)} aria-label="Help">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 6, verticalAlign: "middle" }}><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            Help
          </button>
        </div>
      )}

      {helpOpen && (
        <div className="confirm-overlay" onClick={() => setHelpOpen(false)} role="dialog" aria-label="SSH Key Help">
          <div className="confirm-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <div className="confirm-title">SSH Key Help</div>
            <div className="confirm-message" style={{ textAlign: "left" }}>
              <HelpContent />
            </div>
            <div className="confirm-actions">
              <button type="button" className="btn-outline" onClick={() => setHelpOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {keyChangeModalOpen && (
        <div className="confirm-overlay" onClick={() => setKeyChangeModalOpen(false)} role="dialog">
          <div className="confirm-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <div className="confirm-title">SSH key updated</div>
            <div className="confirm-message">
              Your SSH key has been changed. Updates will sync to all servers within 5 minutes.
            </div>
            <div className="confirm-actions">
              <button type="button" className="primary" onClick={() => setKeyChangeModalOpen(false)}>OK</button>
            </div>
          </div>
        </div>
      )}

      {isAdmin && myKey?.uses_own_key && (
        <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginBottom: "1rem", padding: "0.75rem 1rem", background: "rgba(255,255,255,0.04)", borderRadius: 8, border: "1px solid var(--border)" }}>
          You use your own key. Platform key is hidden. Switch to system key below to manage and download PEM/PPK.
        </p>
      )}
      {isAdmin && !myKey?.uses_own_key && (
        <div className="card keys-section">
          <h2 className="card-subtitle">Platform SSH key</h2>
          <p style={{ color: "var(--text-muted)", marginBottom: "1rem", fontSize: "0.9rem" }}>
            Used for root access to all servers. Regenerate to rotate; re-deploy servers after.
          </p>
          {sshKeyLoading ? <Spinner /> : !sshKey?.has_key ? (
            <button type="button" className="primary" disabled={regenerating} onClick={async () => {
              setRegenerating(true); setMessage(null);
              try {
                await api.post("/api/admin/ssh-key/regenerate");
                setKeyChangeModalOpen(true);
                await fetchSshKey();
              } catch (e) {
                setMessage({ type: "error", text: e instanceof Error ? e.message : "Failed" });
              } finally { setRegenerating(false); }
            }}>
              {regenerating ? "Generating…" : "Generate key"}
            </button>
          ) : (
            <div>
              {sshKey.fingerprint && <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "0.5rem" }}>Fingerprint: <code>{truncateFingerprint(sshKey.fingerprint)}</code></p>}
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                <button type="button" disabled={regenerating} onClick={() => {
                  setConfirmAction({ msg: "Regenerate the platform key? You must re-deploy all servers.", fn: async () => {
                    setRegenerating(true);
                    try {
                      await api.post("/api/admin/ssh-key/regenerate");
                      setKeyChangeModalOpen(true);
                      await fetchSshKey();
                    } finally { setRegenerating(false); }
                  }});
                  setConfirmOpen(true);
                }}>{regenerating ? "Regenerating…" : "Regenerate"}</button>
                <button type="button" onClick={() => downloadFile("/api/admin/ssh-key/download?format=pem", "platform-key.pem")}>Download PEM</button>
                <button type="button" onClick={() => downloadFile("/api/admin/ssh-key/download?format=ppk", "platform-key.ppk")}>Download PPK</button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="card keys-section">
        <h2 className="card-subtitle">Your SSH key</h2>
        <p style={{ color: "var(--text-muted)", marginBottom: "1rem", fontSize: "0.9rem" }}>
          Upload your public key, or use a system-generated key and download PEM/PPK to connect.
        </p>

        <div className="keys-upload-box">
          <label style={{ display: "block", fontWeight: 500, marginBottom: "0.5rem" }}>Upload your public key</label>
          <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "0.5rem" }}>Paste one line (e.g. ssh-ed25519 AAAA... you@host)</p>
          <textarea
            value={ownKeyInput}
            onChange={(e) => setOwnKeyInput(e.target.value)}
            placeholder="ssh-ed25519 AAAA... or ssh-rsa AAAA..."
            rows={2}
            style={{ width: "100%", fontFamily: "monospace", fontSize: "0.85rem", padding: "0.6rem", borderRadius: 8, border: "1px solid var(--border)" }}
          />
          <button type="button" className="primary" disabled={savingOwnKey || !ownKeyInput.trim()} onClick={handleUploadKey} style={{ marginTop: "0.5rem" }}>
            {savingOwnKey ? "Saving…" : "Upload key"}
          </button>
        </div>

        <div className="keys-system-box" style={{ marginTop: "1.5rem" }}>
          <label style={{ display: "block", fontWeight: 500, marginBottom: "0.5rem" }}>System-generated key</label>
          {myKeyLoading ? <Spinner /> : !myKey?.has_key ? (
            <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginBottom: "0.75rem" }}>No key yet. Upload above or generate below.</p>
          ) : (
            <div>
              <p style={{ fontSize: "0.9rem", color: "var(--text-muted)", marginBottom: "0.5rem" }}>
                Current: {myKey.uses_own_key ? "Your uploaded key" : "System key"}. {myKey.fingerprint && <>Fingerprint: <code>{truncateFingerprint(myKey.fingerprint)}</code></>}
              </p>
              {myKey.public_key && (
                <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", fontFamily: "monospace", wordBreak: "break-all" }}>
                  {truncateKey(myKey.public_key)}
                </p>
              )}
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.75rem" }}>
                {myKey.uses_own_key ? (
                  <button type="button" disabled={userKeyRegenerating} onClick={() => {
                    setConfirmAction({ msg: "Switch to system-generated key? You can download PEM/PPK.", fn: async () => {
                      setUserKeyRegenerating(true);
                      try {
                        await api.post("/api/users/me/ssh-key/regenerate");
                        setKeyChangeModalOpen(true);
                        await fetchMyKey();
                      } finally { setUserKeyRegenerating(false); }
                    }});
                    setConfirmOpen(true);
                  }}>{userKeyRegenerating ? "Switching…" : "Switch to system key"}</button>
                ) : (
                  <>
                    <button type="button" disabled={userKeyRegenerating} onClick={() => {
                      setConfirmAction({ msg: "Regenerate key? Old key will stop working.", fn: async () => {
                        setUserKeyRegenerating(true);
                        try {
                          await api.post("/api/users/me/ssh-key/regenerate");
                          setKeyChangeModalOpen(true);
                          await fetchMyKey();
                        } finally { setUserKeyRegenerating(false); }
                      }});
                      setConfirmOpen(true);
                    }}>{userKeyRegenerating ? "Regenerating…" : "Regenerate"}</button>
                    <button type="button" onClick={() => downloadFile("/api/users/me/ssh-key/download?format=pem", "sshcontrol-key.pem")}>Download PEM</button>
                    <button type="button" onClick={() => downloadFile("/api/users/me/ssh-key/download?format=ppk", "sshcontrol-key.ppk")}>Download PPK</button>
                  </>
                )}
              </div>
            </div>
          )}
          {!myKey?.has_key && (
            <button type="button" className="primary" disabled={userKeyRegenerating} onClick={() => {
              setConfirmAction({ msg: "Generate a system key? You can download PEM or PPK.", fn: async () => {
                setUserKeyRegenerating(true);
                try {
                  await api.post("/api/users/me/ssh-key/regenerate");
                  setKeyChangeModalOpen(true);
                  await fetchMyKey();
                } finally { setUserKeyRegenerating(false); }
              }});
              setConfirmOpen(true);
            }}>
              {userKeyRegenerating ? "Generating…" : "Generate system key"}
            </button>
          )}
        </div>
      </div>

      {message && <p className={message.type === "error" ? "error-msg" : "success-msg"}>{message.text}</p>}
      <ConfirmModal open={confirmOpen} title="Confirm" message={confirmAction?.msg || ""} confirmLabel="Continue" onConfirm={async () => { setConfirmOpen(false); if (confirmAction) await confirmAction.fn(); }} onCancel={() => setConfirmOpen(false)} />
    </>
  );

  if (embedded) return <div className="profile-section">{content}</div>;
  return <div className="container app-page">{content}</div>;
}
