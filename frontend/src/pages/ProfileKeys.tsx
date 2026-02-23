import { useState, useEffect } from "react";
import { useAuth } from "../contexts/AuthContext";
import { api, downloadFile } from "../api/client";
import { useToast } from "../components/Toast";
import ConfirmModal from "../components/ConfirmModal";
import Spinner from "../components/Spinner";

type ProfileKeysProps = { embedded?: boolean };

export default function ProfileKeys({ embedded }: ProfileKeysProps) {
  const { user, isAdmin } = useAuth();
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [sshKey, setSshKey] = useState<{ has_key: boolean; public_key?: string; fingerprint?: string } | null>(null);
  const [sshKeyLoading, setSshKeyLoading] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [myKey, setMyKey] = useState<{ has_key: boolean; public_key?: string; fingerprint?: string; uses_own_key?: boolean } | null>(null);
  const [myKeyLoading, setMyKeyLoading] = useState(false);
  const [userKeyRegenerating, setUserKeyRegenerating] = useState(false);
  const [ownKeyInput, setOwnKeyInput] = useState("");
  const [savingOwnKey, setSavingOwnKey] = useState(false);
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{ msg: string; fn: () => Promise<void> } | null>(null);

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
    if (isAdmin) return;
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
  }, [user?.id, isAdmin]);

  const content = (
    <>
      {!embedded && (
        <div className="page-header">
          <h1>Key</h1>
        </div>
      )}
      {isAdmin && (
        <div className="card" style={{ marginBottom: "1.5rem" }}>
          <h2 className="card-subtitle">Platform SSH key</h2>
          <p style={{ color: "var(--text-muted)", marginBottom: "1rem", fontSize: "0.95rem" }}>
            One SSH key is used to access all servers. Regenerate to rotate the key; then re-deploy to servers that already use it.
          </p>
          {sshKeyLoading ? (
            <Spinner />
          ) : !sshKey?.has_key ? (
            <div>
              <p className="text-muted text-sm mb-1">No platform key yet.</p>
              <button
                type="button"
                className="primary"
                disabled={regenerating}
                onClick={async () => {
                  setRegenerating(true);
                  setMessage(null);
                  try {
                    await api.post("/api/admin/ssh-key/regenerate");
                    setMessage({ type: "success", text: "Platform SSH key generated." });
                    await fetchSshKey();
                  } catch (e) {
                    setMessage({ type: "error", text: e instanceof Error ? e.message : "Failed to generate key" });
                  } finally {
                    setRegenerating(false);
                  }
                }}
              >
                {regenerating ? "Generating…" : "Generate key"}
              </button>
            </div>
          ) : (
            <div>
              {sshKey.fingerprint && (
                <p style={{ marginBottom: "0.5rem", fontSize: "0.9rem", color: "var(--text-muted)" }}>
                  Fingerprint: <code>{sshKey.fingerprint}</code>
                </p>
              )}
              {sshKey.public_key && (
                <pre className="key-block" style={{ fontSize: "0.8rem", overflow: "auto", marginBottom: "1rem", padding: "0.75rem", background: "var(--bg-subtle)", borderRadius: "6px" }}>
                  {sshKey.public_key}
                </pre>
              )}
              <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
                <button
                  type="button"
                  disabled={regenerating}
                  onClick={() => {
                    setConfirmAction({
                      msg: "Regenerating will invalidate the current key. You must re-deploy to all servers. Continue?",
                      fn: async () => {
                        setRegenerating(true);
                        setMessage(null);
                        try {
                          await api.post("/api/admin/ssh-key/regenerate");
                          toast("success", "Platform SSH key regenerated.");
                          await fetchSshKey();
                        } catch (e) {
                          setMessage({ type: "error", text: e instanceof Error ? e.message : "Failed to regenerate key" });
                        } finally {
                          setRegenerating(false);
                        }
                      },
                    });
                    setConfirmOpen(true);
                  }}
                >
                  {regenerating ? "Regenerating…" : "Regenerate"}
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await downloadFile("/api/admin/ssh-key/download?format=pem", "platform-key.pem");
                    } catch (e) {
                      setMessage({ type: "error", text: e instanceof Error ? e.message : "Download failed" });
                    }
                  }}
                >
                  Download PEM (OpenSSH)
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await downloadFile("/api/admin/ssh-key/download?format=ppk", "platform-key.ppk");
                    } catch (e) {
                      setMessage({ type: "error", text: e instanceof Error ? e.message : "Download failed" });
                    }
                  }}
                >
                  Download PPK (PuTTY)
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {!isAdmin && (
      <div className="card">
        <h2 className="card-subtitle">Your SSH key</h2>
        <p style={{ color: "var(--text-muted)", marginBottom: "0.5rem", fontSize: "0.95rem" }}>
          Use this key to connect to servers an admin has assigned you to. Your role on each server (admin/sudo or user) is set by the admin.
        </p>
        <p style={{ color: "var(--text-muted)", marginBottom: "1rem", fontSize: "0.9rem" }}>
          You can either <strong>use the system-generated key</strong> (download PEM or PPK below) or <strong>upload your own SSH public key</strong>. If you upload your own, it will replace the system key and be synced to all assigned servers; use your existing private key to connect (no PEM/PPK download).
        </p>

        <details style={{ marginBottom: "1rem" }}>
          <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: "0.95rem" }}>Don&apos;t have an SSH key? Create one (Mac &amp; Windows)</summary>
          <div style={{ marginTop: "0.75rem", fontSize: "0.9rem", color: "var(--text-muted)" }}>
            <p style={{ marginBottom: "0.5rem" }}><strong>Mac (Terminal)</strong></p>
            <ul style={{ marginLeft: "1.25rem", marginBottom: "0.75rem" }}>
              <li>Ed25519 (recommended): <code>ssh-keygen -t ed25519 -C "your_email@example.com"</code></li>
              <li>Or RSA: <code>ssh-keygen -t rsa -b 4096 -C "your_email@example.com"</code></li>
              <li>Press Enter to accept the default path (<code>~/.ssh/id_ed25519</code> or <code>~/.ssh/id_rsa</code>). Optionally set a passphrase.</li>
              <li>Your public key is in <code>~/.ssh/id_ed25519.pub</code> or <code>~/.ssh/id_rsa.pub</code>. Open it and copy the whole line, then paste it below.</li>
            </ul>
            <p style={{ marginBottom: "0.5rem" }}><strong>Windows (PowerShell or Command Prompt)</strong></p>
            <ul style={{ marginLeft: "1.25rem", marginBottom: "0.75rem" }}>
              <li>If OpenSSH is installed (Windows 10/11): run <code>ssh-keygen -t ed25519 -C "your_email@example.com"</code> (or <code>-t rsa -b 4096</code>).</li>
              <li>Default path is <code>%USERPROFILE%\.ssh\id_ed25519</code> or <code>id_rsa</code>. Press Enter for default, optionally set a passphrase.</li>
              <li>Public key: <code>%USERPROFILE%\.ssh\id_ed25519.pub</code> or <code>id_rsa.pub</code>. Open in Notepad and copy the whole line.</li>
            </ul>
            <p style={{ marginBottom: "0.5rem" }}><strong>Windows (PuTTYgen, if you prefer)</strong></p>
            <ul style={{ marginLeft: "1.25rem", marginBottom: "0.75rem" }}>
              <li>Download PuTTYgen, open it → Key → Generate. Move the mouse to add randomness, then set a passphrase if you want.</li>
              <li>Copy the &quot;Public key for pasting into OpenSSH authorized_keys file&quot; and paste it below. Save the private key as a .ppk for PuTTY.</li>
            </ul>
          </div>
        </details>

        <details style={{ marginBottom: "1rem" }}>
          <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: "0.95rem" }}>How to use your key (finding it &amp; connecting)</summary>
          <div style={{ marginTop: "0.75rem", fontSize: "0.9rem", color: "var(--text-muted)" }}>
            <p style={{ marginBottom: "0.5rem" }}><strong>Finding your public key</strong></p>
            <ul style={{ marginLeft: "1.25rem", marginBottom: "0.75rem" }}>
              <li><strong>Mac / Linux:</strong> Usually <code>~/.ssh/id_rsa.pub</code> or <code>~/.ssh/id_ed25519.pub</code>. Open in a text editor and copy the whole line.</li>
              <li><strong>Windows (OpenSSH):</strong> <code>%USERPROFILE%\.ssh\id_rsa.pub</code> or <code>id_ed25519.pub</code>. Copy the whole line.</li>
              <li><strong>Windows (PuTTY):</strong> Use PuTTYgen: load your private key, then copy the &quot;Public key for pasting&quot; line.</li>
            </ul>
            <p style={{ marginBottom: "0.5rem" }}><strong>Connecting with your key</strong></p>
            <ul style={{ marginLeft: "1.25rem" }}>
              <li><strong>Mac / Linux / Windows OpenSSH:</strong> <code>ssh -i ~/.ssh/id_rsa user@host</code> (or <code>id_ed25519</code>). Use the path to your <em>private</em> key.</li>
              <li><strong>Windows (PuTTY):</strong> In PuTTY, Connection → SSH → Auth → Private key file, browse to your .ppk. Then connect as usual.</li>
            </ul>
          </div>
        </details>

        <div style={{ marginBottom: "1.5rem" }}>
          <h3 style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>Use your own SSH key</h3>
          <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginBottom: "0.5rem" }}>Paste your public key (one line, e.g. <code>ssh-rsa AAAA... you@host</code>):</p>
          <textarea
            value={ownKeyInput}
            onChange={(e) => setOwnKeyInput(e.target.value)}
            placeholder="ssh-rsa AAAA... or ssh-ed25519 AAAA..."
            rows={3}
            style={{ width: "100%", maxWidth: "600px", fontFamily: "monospace", fontSize: "0.85rem", padding: "0.5rem", borderRadius: "6px", border: "1px solid var(--border)" }}
          />
          <div style={{ marginTop: "0.5rem" }}>
            <button
              type="button"
              className="primary"
              disabled={savingOwnKey || !ownKeyInput.trim()}
                onClick={async () => {
                  setSavingOwnKey(true);
                  setMessage(null);
                  try {
                    const line = ownKeyInput.trim().split("\n")[0];
                    const res = await api.post<{ message?: string; sync_results?: { server_name: string; success: boolean; error?: string }[] }>(
                      "/api/users/me/ssh-key/public",
                      { public_key: line }
                    );
                    setOwnKeyInput("");
                    await fetchMyKey();
                    const sync = res?.sync_results || [];
                    const ok = sync.filter((r) => r.success).length;
                    const fail = sync.filter((r) => !r.success);
                    const msg =
                      fail.length === 0
                        ? `Your SSH public key has been saved. Synced to ${ok} server(s).`
                        : fail.length === sync.length
                          ? `Key saved but sync failed: ${fail.map((r) => r.error).join("; ")}`
                          : `Key saved. ${ok} synced, ${fail.length} failed: ${fail.map((r) => r.error).join("; ")}`;
                    setMessage({ type: fail.length === sync.length ? "error" : "success", text: msg });
                  } catch (e: unknown) {
                    const msg = e && typeof e === "object" && "detail" in e ? String((e as { detail: unknown }).detail) : (e instanceof Error ? e.message : "Failed to save key");
                    setMessage({ type: "error", text: msg });
                  } finally {
                    setSavingOwnKey(false);
                  }
                }}
            >
              {savingOwnKey ? "Saving…" : "Save my public key"}
            </button>
          </div>
        </div>

        {myKeyLoading ? (
          <Spinner />
        ) : !myKey?.has_key ? (
          <div>
            <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginBottom: "1rem" }}>
            You don’t have an SSH key yet. Generate a system key (PEM/PPK) or upload your own public key above.
            </p>
            <button
              type="button"
              className="primary"
              disabled={userKeyRegenerating}
              onClick={async () => {
                setUserKeyRegenerating(true);
                setMessage(null);
                try {
                  const res = await api.post<{ message?: string; sync_results?: { success: boolean; error?: string }[] }>(
                    "/api/users/me/ssh-key/regenerate"
                  );
                  toast("success", "SSH key generated. Download PEM or PPK below.");
                  await fetchMyKey();
                  const sync = res?.sync_results || [];
                  const fail = sync.filter((r) => !r.success);
                  if (fail.length > 0) {
                    setMessage({ type: "error", text: `Sync failed on ${fail.length} server(s): ${fail.map((r) => r.error).join("; ")}` });
                  }
                } catch (e) {
                  setMessage({ type: "error", text: e instanceof Error ? e.message : "Failed to generate key" });
                } finally {
                  setUserKeyRegenerating(false);
                }
              }}
            >
              {userKeyRegenerating ? "Generating…" : "Generate key"}
            </button>
          </div>
        ) : (
          <div>
            <p style={{ marginBottom: "0.5rem", fontSize: "0.9rem", color: "var(--text-muted)" }}>
              Current key: {myKey.uses_own_key ? "Your uploaded public key" : "System-generated key (PEM/PPK below)"}.
              {myKey.fingerprint && <> Fingerprint: <code>{myKey.fingerprint}</code></>}
            </p>
            {myKey.public_key && (
              <pre className="key-block" style={{ fontSize: "0.8rem", overflow: "auto", marginBottom: "1rem", padding: "0.75rem", background: "var(--bg-subtle)", borderRadius: "6px" }}>
                {myKey.public_key}
              </pre>
            )}
            <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
              {myKey.uses_own_key ? (
                <button
                  type="button"
                  disabled={userKeyRegenerating}
                  onClick={() => {
                    setConfirmAction({
                      msg: "Switch back to a system-generated key? You will get a new key and can download PEM/PPK. Servers will be updated within a few minutes. Continue?",
                      fn: async () => {
                        setUserKeyRegenerating(true);
                        setMessage(null);
                        try {
                          const res = await api.post<{ message?: string; sync_results?: { success: boolean; error?: string }[] }>(
                            "/api/users/me/ssh-key/regenerate"
                          );
                          toast("success", "Switched to system key. Download PEM or PPK below.");
                          await fetchMyKey();
                          const sync = res?.sync_results || [];
                          const fail = sync.filter((r) => !r.success);
                          if (fail.length > 0) {
                            setMessage({ type: "error", text: `Sync failed on ${fail.length} server(s): ${fail.map((r) => r.error).join("; ")}` });
                          }
                        } catch (e) {
                          setMessage({ type: "error", text: e instanceof Error ? e.message : "Failed to switch key" });
                        } finally {
                          setUserKeyRegenerating(false);
                        }
                      },
                    });
                    setConfirmOpen(true);
                  }}
                >
                  {userKeyRegenerating ? "Switching…" : "Switch to system-generated key"}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={userKeyRegenerating}
                    onClick={() => {
                      setConfirmAction({
                        msg: "Regenerate your SSH key? The old key will stop working. You must re-download PEM/PPK and save them. Servers will get the new key within a few minutes. Continue?",
                        fn: async () => {
                          setUserKeyRegenerating(true);
                          setMessage(null);
                          try {
                            const res = await api.post<{ message?: string; sync_results?: { success: boolean; error?: string }[] }>(
                              "/api/users/me/ssh-key/regenerate"
                            );
                            toast("success", "SSH key regenerated. Re-download PEM or PPK.");
                            await fetchMyKey();
                            const sync = res?.sync_results || [];
                            const fail = sync.filter((r) => !r.success);
                            if (fail.length > 0) {
                              setMessage({ type: "error", text: `Sync failed on ${fail.length} server(s): ${fail.map((r) => r.error).join("; ")}` });
                            }
                          } catch (e) {
                            setMessage({ type: "error", text: e instanceof Error ? e.message : "Failed to regenerate key" });
                          } finally {
                            setUserKeyRegenerating(false);
                          }
                        },
                      });
                      setConfirmOpen(true);
                    }}
                  >
                    {userKeyRegenerating ? "Regenerating…" : "Regenerate key"}
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await downloadFile("/api/users/me/ssh-key/download?format=pem", "sshcontrol-key.pem");
                      } catch (e) {
                        setMessage({ type: "error", text: e instanceof Error ? e.message : "Download failed" });
                      }
                    }}
                  >
                    Download PEM (OpenSSH)
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await downloadFile("/api/users/me/ssh-key/download?format=ppk", "sshcontrol-key.ppk");
                      } catch (e) {
                        setMessage({ type: "error", text: e instanceof Error ? e.message : "Download failed" });
                      }
                    }}
                  >
                    Download PPK (PuTTY)
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
      )}

      {message && (
        <p className={message.type === "error" ? "error-msg" : "success-msg"} style={{ marginTop: "1rem" }}>
          {message.text}
        </p>
      )}
      <ConfirmModal
        open={confirmOpen}
        title="Confirm"
        message={confirmAction?.msg || ""}
        confirmLabel="Continue"
        onConfirm={async () => {
          setConfirmOpen(false);
          if (confirmAction) await confirmAction.fn();
        }}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );

  if (embedded) {
    return <div className="profile-section">{content}</div>;
  }
  return <div className="container app-page">{content}</div>;
}
