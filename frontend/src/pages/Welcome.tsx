import { useState, useEffect } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../api/client";
import { validatePassword } from "../utils/password";
import PasswordField from "../components/PasswordField";
import { QRCodeSVG } from "qrcode.react";
import LogoSpinner from "../components/LogoSpinner";
import { normalizeToE164, isValidE164 } from "../lib/phone";

type PlanInfo = {
  id: string;
  name: string;
  description?: string;
  price: number;
  currency: string;
  duration_label: string;
  max_users: number;
  max_servers: number;
  is_free: boolean;
};

type PlanLimits = {
  plan_name: string;
  max_users: number;
  max_servers: number;
  current_users: number;
  current_servers: number;
};

export default function Welcome() {
  const { user, loading, refreshUser } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);

  // Require auth: after accept-invitation we have tokens; direct visitors without auth go to login
  if (!user) {
    if (loading) return <div className="app-loading"><LogoSpinner /></div>;
    return <Navigate to="/login" replace />;
  }

  const isAdmin = user?.is_superuser || user?.roles?.some((r) => r.name === "admin");
  const isGoogleUser = user?.is_google_user === true;
  const needsCompanyStep = isGoogleUser && isAdmin;
  const needsPassword = user?.needs_initial_password === true;
  const needsUsername = user?.needs_initial_username === true;
  const baseTotalSteps = needsPassword
    ? (isAdmin ? 6 : 5)   // admin: username, password, 2FA, sms, plan, guide | user: username, password, 2FA, sms, guide
    : needsUsername
      ? (isAdmin ? 5 : 4) // admin: username, 2FA, sms, plan, guide | (user wouldn't have needs_initial_username)
      : (isAdmin ? 4 : 3);  // admin: 2FA, sms, plan, guide | user: 2FA, sms, guide
  const totalSteps = needsCompanyStep ? baseTotalSteps + 1 : baseTotalSteps;

  const [companyName, setCompanyName] = useState(user?.company_name ?? "");
  const [companyNameError, setCompanyNameError] = useState("");
  const [companyNameLoading, setCompanyNameLoading] = useState(false);
  const [username, setUsername] = useState(user?.username ?? "");
  const [usernameError, setUsernameError] = useState("");
  const [usernameLoading, setUsernameLoading] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);

  const [totpSecret, setTotpSecret] = useState("");
  const [totpUri, setTotpUri] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [totpError, setTotpError] = useState("");
  const [totpLoading, setTotpLoading] = useState(false);
  const [totpSetup, setTotpSetup] = useState(false);

  const [phone, setPhone] = useState(user?.phone ?? "");
  const [phoneVerifyCode, setPhoneVerifyCode] = useState("");
  const [phoneSubStep, setPhoneSubStep] = useState<"enter" | "verify">("enter");
  const [phoneError, setPhoneError] = useState("");
  const [phoneLoading, setPhoneLoading] = useState(false);

  const [plans, setPlans] = useState<PlanInfo[]>([]);
  const [limits, setLimits] = useState<PlanLimits | null>(null);

  useEffect(() => {
    setPhone(user?.phone ?? "");
  }, [user?.phone]);

  useEffect(() => {
    setCompanyName(user?.company_name ?? "");
  }, [user?.company_name]);

  useEffect(() => {
    if (isAdmin) {
      api.get<PlanInfo[]>("/api/public/plans").then(setPlans).catch(() => {});
      api.get<PlanLimits>("/api/auth/plan-limits").then(setLimits).catch(() => {});
    }
  }, [isAdmin]);

  const saveInitialUsername = async () => {
    setUsernameError("");
    const uname = username.trim();
    if (uname.length < 2) {
      setUsernameError("Username must be at least 2 characters");
      return;
    }
    setUsernameLoading(true);
    try {
      await api.post("/api/auth/set-initial-username", { username: uname });
      await refreshUser();
      setStep(0);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to set username";
      if (msg.toLowerCase().includes("already set")) {
        await refreshUser();
        setStep(0);
      } else {
        setUsernameError(msg);
      }
    } finally {
      setUsernameLoading(false);
    }
  };

  const saveInitialPassword = async () => {
    setPasswordError("");
    const uname = username.trim();
    if (uname.length < 2) {
      setPasswordError("Username must be at least 2 characters");
      return;
    }
    const pwdErr = validatePassword(password);
    if (pwdErr) {
      setPasswordError(pwdErr);
      return;
    }
    if (password !== confirmPassword) {
      setPasswordError("Passwords do not match");
      return;
    }
    setPasswordLoading(true);
    try {
      await api.post("/api/auth/set-initial-password", { username: uname, new_password: password });
      await refreshUser();
      setStep(0);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to set password";
      if (msg.toLowerCase().includes("already set")) {
        await refreshUser();
        setStep(0);
      } else {
        setPasswordError(msg);
      }
    } finally {
      setPasswordLoading(false);
    }
  };

  const setupTotp = async () => {
    setTotpError("");
    setTotpLoading(true);
    try {
      const res = await api.post<{ secret: string; provisioning_uri: string }>("/api/auth/totp/setup");
      setTotpSecret(res.secret);
      setTotpUri(res.provisioning_uri);
      setTotpSetup(true);
    } catch (err) {
      setTotpError(err instanceof Error ? err.message : "Failed to setup 2FA");
    } finally {
      setTotpLoading(false);
    }
  };

  const verifyTotp = async () => {
    setTotpError("");
    setTotpLoading(true);
    try {
      await api.post("/api/auth/totp/verify", { code: totpCode });
      await refreshUser();
      setStep(phoneStepIndex);
    } catch (err) {
      setTotpError(err instanceof Error ? err.message : "Invalid code");
    } finally {
      setTotpLoading(false);
    }
  };

  const requestPhoneCode = async () => {
    setPhoneError("");
    const phoneE164 = phone.trim() ? normalizeToE164(phone) : "";
    if (!phoneE164 || !isValidE164(phoneE164)) {
      setPhoneError("Please enter a valid phone number with country code.");
      return;
    }
    setPhoneLoading(true);
    try {
      await api.post("/api/auth/request-phone-verification", { phone: phoneE164 });
      setPhoneSubStep("verify");
      setPhoneVerifyCode("");
      setPhoneError("");
    } catch (err) {
      setPhoneError(err instanceof Error ? err.message : "Failed to send code");
    } finally {
      setPhoneLoading(false);
    }
  };

  const verifyAndSavePhone = async () => {
    setPhoneError("");
    const phoneE164 = phone.trim() ? normalizeToE164(phone) : "";
    if (!phoneE164 || !isValidE164(phoneE164) || phoneVerifyCode.length < 4) {
      setPhoneError("Enter the 4-digit code from your phone.");
      return;
    }
    setPhoneLoading(true);
    try {
      await api.post("/api/auth/verify-phone", { phone: phoneE164, code: phoneVerifyCode });
      await refreshUser();
      setPhoneSubStep("enter");
      setPhoneVerifyCode("");
      setStep(isAdmin ? planStep : guideStep);
    } catch (err) {
      setPhoneError(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setPhoneLoading(false);
    }
  };

  const completeOnboarding = async () => {
    try {
      await api.post("/api/auth/complete-onboarding");
      await refreshUser();
      navigate("/");
    } catch {
      navigate("/");
    }
  };

  const saveCompanyName = async () => {
    setCompanyNameError("");
    const name = companyName.trim();
    if (name.length < 2) {
      setCompanyNameError("Company name must be at least 2 characters");
      return;
    }
    setCompanyNameLoading(true);
    try {
      await api.patch("/api/tenant/me", { company_name: name });
      await refreshUser();
      setStep(1);
    } catch (err) {
      setCompanyNameError(err instanceof Error ? err.message : "Failed to set company name");
    } finally {
      setCompanyNameLoading(false);
    }
  };

  const stepLabels = needsCompanyStep
    ? ["Company Name", ...(needsPassword
        ? (isAdmin ? ["Set Username", "Set Password", "Two-Factor Auth", "Phone Number", "Your Plan", "Getting Started"] : ["Set Username", "Set Password", "Two-Factor Auth", "Phone Number", "Getting Started"])
        : needsUsername
          ? (isAdmin ? ["Set Username", "Two-Factor Auth", "Phone Number", "Your Plan", "Getting Started"] : ["Set Username", "Two-Factor Auth", "Phone Number", "Getting Started"])
          : (isAdmin ? ["Two-Factor Auth", "Phone Number", "Your Plan", "Getting Started"] : ["Two-Factor Auth", "Phone Number", "Getting Started"]))]
    : needsPassword
    ? (isAdmin
        ? ["Set Username", "Set Password", "Two-Factor Auth", "Phone Number", "Your Plan", "Getting Started"]
        : ["Set Username", "Set Password", "Two-Factor Auth", "Phone Number", "Getting Started"])
    : needsUsername
      ? (isAdmin
          ? ["Set Username", "Two-Factor Auth", "Phone Number", "Your Plan", "Getting Started"]
          : ["Set Username", "Two-Factor Auth", "Phone Number", "Getting Started"])
      : (isAdmin
          ? ["Two-Factor Auth", "Phone Number", "Your Plan", "Getting Started"]
          : ["Two-Factor Auth", "Phone Number", "Getting Started"]);

  const off = needsCompanyStep ? 1 : 0;
  const companyStep = 0;
  const usernameStep = off;
  const passwordStep = needsPassword ? off + 1 : -1;
  const totpStep = needsPassword ? off + 2 : needsUsername ? off + 1 : off;
  const phoneStepIndex = needsPassword ? off + 3 : needsUsername ? off + 2 : off + 1;
  const planStep = isAdmin ? (needsPassword ? off + 4 : needsUsername ? off + 3 : off + 2) : -1;
  const guideStep = isAdmin ? (needsPassword ? off + 5 : needsUsername ? off + 4 : off + 3) : (needsPassword ? off + 4 : needsUsername ? off + 3 : off + 2);

  const cardStyle: React.CSSProperties = {
    background: "rgba(18, 42, 66, 0.65)",
    backdropFilter: "blur(20px)",
    border: "1px solid rgba(255, 255, 255, 0.1)",
    borderRadius: 16,
    padding: "2rem",
    maxWidth: 560,
    width: "100%",
    margin: "0 auto",
  };

  const btnPrimary: React.CSSProperties = {
    background: "linear-gradient(135deg, #2dd4bf, #14b8a6)",
    color: "#022c22",
    fontWeight: 600,
    padding: "0.75rem 2rem",
    borderRadius: 10,
    border: "none",
    cursor: "pointer",
    fontSize: "0.95rem",
  };

  const btnSecondary: React.CSSProperties = {
    background: "rgba(255,255,255,0.08)",
    color: "#94a3b8",
    fontWeight: 500,
    padding: "0.75rem 2rem",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.12)",
    cursor: "pointer",
    fontSize: "0.9rem",
  };

  const guideItemStyle: React.CSSProperties = {
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 12,
    padding: "1.25rem",
    display: "flex",
    gap: "1rem",
    alignItems: "flex-start",
  };

  const guideNumStyle: React.CSSProperties = {
    width: 36, height: 36, borderRadius: "50%", flexShrink: 0,
    background: "linear-gradient(135deg, #2dd4bf, #14b8a6)",
    color: "#022c22", fontWeight: 700, fontSize: "0.9rem",
    display: "flex", alignItems: "center", justifyContent: "center",
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0a1628", padding: "2rem", flexDirection: "column", gap: "2rem" }}>
      {/* Welcome greeting */}
      <div style={{ textAlign: "center" }}>
        <h1 style={{ color: "#e2e8f0", margin: 0, fontSize: "1.6rem" }}>
          Welcome{user?.full_name ? `, ${user.full_name}` : ""}!
        </h1>
        <p style={{ color: "#64748b", margin: "0.5rem 0 0", fontSize: "0.9rem" }}>
          {isAdmin ? "Let's set up your account and get your team connected." : "Let's set up your account so you can start connecting to servers."}
        </p>
      </div>

      {/* Progress steps */}
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap", justifyContent: "center" }}>
        {stepLabels.map((label, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <div style={{
              width: 32, height: 32, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
              background: step >= i ? "linear-gradient(135deg, #2dd4bf, #14b8a6)" : "rgba(255,255,255,0.08)",
              color: step >= i ? "#022c22" : "#64748b", fontWeight: 700, fontSize: "0.85rem",
            }}>
              {step > i ? "\u2713" : i + 1}
            </div>
            <span style={{ color: step >= i ? "#e2e8f0" : "#475569", fontSize: "0.85rem", fontWeight: step === i ? 600 : 400 }}>{label}</span>
            {i < totalSteps - 1 && <div style={{ width: 40, height: 2, background: step > i ? "#2dd4bf" : "rgba(255,255,255,0.08)", borderRadius: 1 }} />}
          </div>
        ))}
      </div>

      {/* Step 0: Company Name (Google admin only) */}
      {needsCompanyStep && step === companyStep && (
        <div style={cardStyle}>
          <h2 style={{ color: "#2dd4bf", marginTop: 0, marginBottom: "0.5rem" }}>Your Company Name</h2>
          <p style={{ color: "#94a3b8", marginBottom: "1.5rem", lineHeight: 1.6 }}>
            Enter your company or organization name. This will be shown to your team and in the dashboard.
          </p>
          <div style={{ maxWidth: 320, margin: "0 auto" }}>
            <label style={{ display: "block", color: "#94a3b8", marginBottom: "0.5rem", fontSize: "0.9rem" }}>Company name</label>
            <input
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="e.g. Acme Corp"
              minLength={2}
              maxLength={255}
              style={{ width: "100%", padding: "0.75rem", background: "rgba(10,22,40,0.9)", border: "1px solid rgba(27,79,114,0.7)", borderRadius: 8, color: "#e2e8f0", fontSize: "1rem", marginBottom: "1rem" }}
            />
            {companyNameError && <p style={{ color: "#ef4444", fontSize: "0.85rem", marginTop: "0.5rem" }}>{companyNameError}</p>}
            <button onClick={saveCompanyName} disabled={companyNameLoading || companyName.trim().length < 2} style={{ ...btnPrimary, width: "100%", marginTop: "1.5rem" }}>
              {companyNameLoading ? "Saving…" : "Continue"}
            </button>
          </div>
        </div>
      )}

      {/* Set Username (admin signup or first step when needsPassword) */}
      {step === usernameStep && (needsUsername || needsPassword) && (
        <div style={cardStyle}>
          <h2 style={{ color: "#2dd4bf", marginTop: 0, marginBottom: "0.5rem" }}>Choose Your Username</h2>
          <p style={{ color: "#94a3b8", marginBottom: "1.5rem", lineHeight: 1.6 }}>
            Pick a username you'll use to sign in. It must be at least 2 characters and unique.
          </p>
          <div style={{ maxWidth: 320, margin: "0 auto" }}>
            <label style={{ display: "block", color: "#94a3b8", marginBottom: "0.5rem", fontSize: "0.9rem" }}>Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Choose a username (min 2 characters)"
              minLength={2}
              maxLength={100}
              autoComplete="username"
              style={{ width: "100%", padding: "0.75rem", background: "rgba(10,22,40,0.9)", border: "1px solid rgba(27,79,114,0.7)", borderRadius: 8, color: "#e2e8f0", fontSize: "1rem", marginBottom: "1rem" }}
            />
            {usernameError && <p style={{ color: "#ef4444", fontSize: "0.85rem", marginTop: "0.5rem" }}>{usernameError}</p>}
            {needsPassword ? (
              <>
                <button
                  onClick={async () => {
                    setUsernameError("");
                    const uname = username.trim();
                    if (uname.length < 2) {
                      setUsernameError("Username must be at least 2 characters");
                      return;
                    }
                    setUsernameLoading(true);
                    try {
                      const res = await api.get<{ available: boolean }>(`/api/auth/check-username?username=${encodeURIComponent(uname)}`);
                      if (res.available) {
                        setStep(passwordStep);
                      } else {
                        setUsernameError("This username is already taken. Please choose another.");
                      }
                    } catch {
                      setUsernameError("Could not check username. Please try again.");
                    } finally {
                      setUsernameLoading(false);
                    }
                  }}
                  disabled={username.trim().length < 2 || usernameLoading}
                  style={{ ...btnPrimary, width: "100%", marginTop: "1.5rem" }}
                >
                  {usernameLoading ? "Checking..." : "Continue"}
                </button>
              </>
            ) : (
              <button onClick={saveInitialUsername} disabled={usernameLoading || username.trim().length < 2} style={{ ...btnPrimary, width: "100%", marginTop: "1.5rem" }}>
                {usernameLoading ? "Setting..." : "Set Username & Continue"}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Step 1: Set Password (invited users only, after username step) */}
      {needsPassword && step === passwordStep && (
        <div style={cardStyle}>
          <h2 style={{ color: "#2dd4bf", marginTop: 0, marginBottom: "0.5rem" }}>Set Your Password</h2>
          <p style={{ color: "#94a3b8", marginBottom: "0.5rem", lineHeight: 1.6 }}>
            Choose a password for your account. You will use it with your username to sign in.
          </p>
          <p style={{ color: "#64748b", fontSize: "0.9rem", marginBottom: "1.5rem" }}>
            Username: <strong style={{ color: "#e2e8f0" }}>{username.trim()}</strong>
          </p>
          <div style={{ maxWidth: 320, margin: "0 auto" }}>
            <PasswordField
              id="welcome-password"
              value={password}
              onChange={setPassword}
              label="Password"
              placeholder="Enter password"
              inputStyle={{ width: "100%", padding: "0.75rem", background: "rgba(10,22,40,0.9)", border: "1px solid rgba(27,79,114,0.7)", borderRadius: 8, color: "#e2e8f0", fontSize: "1rem" }}
            />
            <div style={{ marginTop: "1rem" }}>
              <label style={{ display: "block", color: "#94a3b8", marginBottom: "0.5rem", fontSize: "0.9rem" }}>Confirm Password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repeat password"
                autoComplete="new-password"
                style={{ width: "100%", padding: "0.75rem", background: "rgba(10,22,40,0.9)", border: "1px solid rgba(27,79,114,0.7)", borderRadius: 8, color: "#e2e8f0", fontSize: "1rem" }}
              />
            </div>
            {passwordError && <p style={{ color: "#ef4444", fontSize: "0.85rem", marginTop: "0.5rem" }}>{passwordError}</p>}
            <div style={{ display: "flex", gap: "1rem", marginTop: "1.5rem", flexDirection: "column" }}>
              <button onClick={saveInitialPassword} disabled={passwordLoading || username.trim().length < 2 || password.length < 8 || password !== confirmPassword} style={{ ...btnPrimary, width: "100%" }}>
                {passwordLoading ? "Setting..." : "Set Password & Continue"}
              </button>
              <button onClick={() => { setStep(usernameStep); setPasswordError(""); setPassword(""); setConfirmPassword(""); }} style={{ ...btnSecondary, width: "100%" }}>
                Back to change username
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2FA step */}
      {step === totpStep && (
        <div style={cardStyle}>
          <h2 style={{ color: "#2dd4bf", marginTop: 0, marginBottom: "0.5rem" }}>Secure Your Account</h2>
          <p style={{ color: "#94a3b8", marginBottom: "1.5rem", lineHeight: 1.6 }}>
            We strongly recommend enabling Two-Factor Authentication (2FA) for an extra layer of security.
          </p>

          {!totpSetup ? (
            <div style={{ display: "flex", gap: "1rem", justifyContent: "center" }}>
              <button onClick={setupTotp} disabled={totpLoading} style={btnPrimary}>
                {totpLoading ? "Setting up..." : "Enable 2FA"}
              </button>
              <button onClick={() => setStep(phoneStepIndex)} style={btnSecondary}>
                Skip for now
              </button>
            </div>
          ) : (
            <div>
              <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
                <p style={{ color: "#e2e8f0", marginBottom: "1rem", fontSize: "0.9rem" }}>
                  Scan this QR code with your authenticator app:
                </p>
                <div style={{ display: "inline-block", background: "white", padding: 12, borderRadius: 12 }}>
                  <QRCodeSVG value={totpUri} size={180} />
                </div>
                <p style={{ color: "#64748b", fontSize: "0.8rem", marginTop: "0.75rem", wordBreak: "break-all" }}>
                  Manual key: <code style={{ color: "#2dd4bf" }}>{totpSecret}</code>
                </p>
              </div>
              <div style={{ maxWidth: 280, margin: "0 auto" }}>
                <label style={{ display: "block", color: "#94a3b8", marginBottom: "0.5rem", fontSize: "0.9rem" }}>Enter the 6-digit code:</label>
                <input
                  type="text" maxLength={6} value={totpCode} onChange={(e) => setTotpCode(e.target.value)}
                  placeholder="000000"
                  style={{ width: "100%", textAlign: "center", fontSize: "1.5rem", letterSpacing: "0.3em", padding: "0.75rem", background: "rgba(10,22,40,0.9)", border: "1px solid rgba(27,79,114,0.7)", borderRadius: 8, color: "#e2e8f0" }}
                />
                {totpError && <p style={{ color: "#ef4444", fontSize: "0.85rem", marginTop: "0.5rem" }}>{totpError}</p>}
                <button onClick={verifyTotp} disabled={totpLoading || totpCode.length < 6} style={{ ...btnPrimary, width: "100%", marginTop: "1rem" }}>
                  {totpLoading ? "Verifying..." : "Verify & Enable"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Phone step */}
      {step === phoneStepIndex && (
        <div style={cardStyle}>
          <h2 style={{ color: "#2dd4bf", marginTop: 0, marginBottom: "0.5rem" }}>Add Your Phone Number</h2>
          <p style={{ color: "#94a3b8", marginBottom: "1.5rem", lineHeight: 1.6 }}>
            Add a phone number for account recovery and notifications. We'll send a verification code to confirm.
          </p>
          <div style={{ maxWidth: 320, margin: "0 auto" }}>
            <div style={{ marginBottom: "1rem" }}>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/[^\d+]/g, "").slice(0, 16))}
                placeholder="+32xxx for country and phone format"
                disabled={phoneSubStep === "verify"}
                style={{ width: "100%", padding: "0.75rem", background: "rgba(10,22,40,0.9)", border: "1px solid rgba(27,79,114,0.7)", borderRadius: 8, color: "#e2e8f0", fontSize: "1rem" }}
              />
            </div>
            {phoneSubStep === "verify" && (
              <div style={{ marginBottom: "1rem" }}>
                <label style={{ display: "block", color: "#94a3b8", marginBottom: "0.5rem", fontSize: "0.9rem" }}>Verification code</label>
                <input
                  type="text"
                  value={phoneVerifyCode}
                  onChange={(e) => setPhoneVerifyCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
                  placeholder="0000"
                  maxLength={8}
                  inputMode="numeric"
                  style={{ width: "100%", padding: "0.75rem", background: "rgba(10,22,40,0.9)", border: "1px solid rgba(27,79,114,0.7)", borderRadius: 8, color: "#e2e8f0", fontSize: "1rem", textAlign: "center", letterSpacing: "0.2em" }}
                />
              </div>
            )}
            {phoneError && <p style={{ color: "#ef4444", fontSize: "0.85rem", marginTop: "0.5rem" }}>{phoneError}</p>}
            <div style={{ display: "flex", gap: "1rem", marginTop: "1.5rem" }}>
              {phoneSubStep === "verify" ? (
                <>
                  <button onClick={verifyAndSavePhone} disabled={phoneLoading || phoneVerifyCode.length < 4} style={{ ...btnPrimary, flex: 1 }}>
                    {phoneLoading ? "Verifying..." : "Verify & Save"}
                  </button>
                  <button onClick={() => { setPhoneSubStep("enter"); setPhoneError(""); }} style={{ ...btnSecondary, flex: 1 }}>
                    Back
                  </button>
                </>
              ) : (
                <>
                  <button onClick={requestPhoneCode} disabled={phoneLoading || !phone.trim()} style={{ ...btnPrimary, flex: 1 }}>
                    {phoneLoading ? "Sending..." : "Send verification code"}
                  </button>
                  <button onClick={() => setStep(isAdmin ? planStep : guideStep)} style={{ ...btnSecondary, flex: 1 }}>
                    Skip
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Step 2 (admin only): Plan */}
      {step === planStep && isAdmin && (
        <div style={{ ...cardStyle, maxWidth: 700 }}>
          <h2 style={{ color: "#2dd4bf", marginTop: 0, marginBottom: "0.5rem" }}>Your Plan</h2>
          {limits && (
            <div style={{ background: "rgba(45,212,191,0.08)", border: "1px solid rgba(45,212,191,0.2)", borderRadius: 12, padding: "1rem 1.25rem", marginBottom: "1.5rem" }}>
              <p style={{ color: "#2dd4bf", fontWeight: 600, margin: "0 0 0.25rem" }}>Current Plan: {limits.plan_name}</p>
              <p style={{ color: "#94a3b8", margin: 0, fontSize: "0.9rem" }}>
                {limits.current_users}/{limits.max_users} users &bull; {limits.current_servers}/{limits.max_servers} servers
              </p>
            </div>
          )}

          <p style={{ color: "#94a3b8", marginBottom: "1.5rem", lineHeight: 1.6 }}>
            Upgrade anytime to unlock more users and servers:
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "1rem", marginBottom: "2rem" }}>
            {plans.map((p) => (
              <div key={p.id} style={{
                background: p.is_free ? "rgba(45,212,191,0.06)" : "rgba(255,255,255,0.04)",
                border: `1px solid ${p.is_free ? "rgba(45,212,191,0.25)" : "rgba(255,255,255,0.08)"}`,
                borderRadius: 12, padding: "1.25rem", textAlign: "center",
              }}>
                <h3 style={{ color: "#e2e8f0", margin: "0 0 0.5rem", fontSize: "1.1rem" }}>{p.name}</h3>
                <div style={{ color: "#2dd4bf", fontSize: "1.5rem", fontWeight: 700 }}>
                  {p.is_free ? "Free" : `$${p.price}`}
                </div>
                <div style={{ color: "#64748b", fontSize: "0.8rem", marginBottom: "0.75rem" }}>{p.duration_label}</div>
                <div style={{ color: "#94a3b8", fontSize: "0.85rem", lineHeight: 1.6 }}>
                  <div>{p.max_users} users</div>
                  <div>{p.max_servers} servers</div>
                </div>
              </div>
            ))}
          </div>

          <div style={{ textAlign: "center" }}>
            <button onClick={() => setStep(guideStep)} style={btnPrimary}>
              Next
            </button>
          </div>
        </div>
      )}

      {/* Final Step: Getting Started guide */}
      {step === guideStep && (
        <div style={{ ...cardStyle, maxWidth: 640 }}>
          <h2 style={{ color: "#2dd4bf", marginTop: 0, marginBottom: "0.5rem" }}>
            {isAdmin ? "You're All Set! Here's How to Get Started" : "You're All Set! Here's What's Next"}
          </h2>
          <p style={{ color: "#94a3b8", marginBottom: "1.5rem", lineHeight: 1.6 }}>
            {isAdmin
              ? "Follow these steps to connect your first server and add your team."
              : "Follow these steps to start connecting to your assigned servers."
            }
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: "1rem", marginBottom: "2rem" }}>
            {isAdmin ? (
              <>
                <div style={guideItemStyle}>
                  <div style={guideNumStyle}>1</div>
                  <div>
                    <h4 style={{ color: "#e2e8f0", margin: "0 0 0.25rem", fontSize: "0.95rem" }}>Generate Your Platform SSH Key</h4>
                    <p style={{ color: "#94a3b8", margin: 0, fontSize: "0.85rem", lineHeight: 1.5 }}>
                      Go to <strong style={{ color: "#2dd4bf" }}>Admin &rarr; SSH Key</strong> and click <em>Regenerate</em>. This key is used to manage your servers remotely.
                    </p>
                  </div>
                </div>
                <div style={guideItemStyle}>
                  <div style={guideNumStyle}>2</div>
                  <div>
                    <h4 style={{ color: "#e2e8f0", margin: "0 0 0.25rem", fontSize: "0.95rem" }}>Add Your First Server</h4>
                    <p style={{ color: "#94a3b8", margin: 0, fontSize: "0.85rem", lineHeight: 1.5 }}>
                      Go to <strong style={{ color: "#2dd4bf" }}>Servers &rarr; Add Server</strong>, select your OS, and run the deploy command on your server. It takes less than a minute.
                    </p>
                  </div>
                </div>
                <div style={guideItemStyle}>
                  <div style={guideNumStyle}>3</div>
                  <div>
                    <h4 style={{ color: "#e2e8f0", margin: "0 0 0.25rem", fontSize: "0.95rem" }}>Invite Your Team</h4>
                    <p style={{ color: "#94a3b8", margin: 0, fontSize: "0.85rem", lineHeight: 1.5 }}>
                      Go to <strong style={{ color: "#2dd4bf" }}>Users &rarr; Add User</strong> to send email invitations or add users manually.
                    </p>
                  </div>
                </div>
                <div style={guideItemStyle}>
                  <div style={guideNumStyle}>4</div>
                  <div>
                    <h4 style={{ color: "#e2e8f0", margin: "0 0 0.25rem", fontSize: "0.95rem" }}>Assign Server Access</h4>
                    <p style={{ color: "#94a3b8", margin: 0, fontSize: "0.85rem", lineHeight: 1.5 }}>
                      Open any server and grant access to users or groups. Changes sync to your servers automatically.
                    </p>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div style={guideItemStyle}>
                  <div style={guideNumStyle}>1</div>
                  <div>
                    <h4 style={{ color: "#e2e8f0", margin: "0 0 0.25rem", fontSize: "0.95rem" }}>Generate Your SSH Key</h4>
                    <p style={{ color: "#94a3b8", margin: 0, fontSize: "0.85rem", lineHeight: 1.5 }}>
                      Go to <strong style={{ color: "#2dd4bf" }}>Profile &rarr; SSH Keys</strong> and generate your key pair. You can also upload your own public key if you prefer.
                    </p>
                  </div>
                </div>
                <div style={guideItemStyle}>
                  <div style={guideNumStyle}>2</div>
                  <div>
                    <h4 style={{ color: "#e2e8f0", margin: "0 0 0.25rem", fontSize: "0.95rem" }}>Check Your Assigned Servers</h4>
                    <p style={{ color: "#94a3b8", margin: 0, fontSize: "0.85rem", lineHeight: 1.5 }}>
                      Go to <strong style={{ color: "#2dd4bf" }}>Servers</strong> to see the servers you have access to. Your admin will grant you access to servers.
                    </p>
                  </div>
                </div>
                <div style={guideItemStyle}>
                  <div style={guideNumStyle}>3</div>
                  <div>
                    <h4 style={{ color: "#e2e8f0", margin: "0 0 0.25rem", fontSize: "0.95rem" }}>Connect via SSH</h4>
                    <p style={{ color: "#94a3b8", margin: 0, fontSize: "0.85rem", lineHeight: 1.5 }}>
                      Download your private key from the SSH Keys page and use it to connect: <code style={{ color: "#2dd4bf", background: "rgba(45,212,191,0.1)", padding: "2px 6px", borderRadius: 4 }}>ssh -i key.pem username@server</code>
                    </p>
                  </div>
                </div>
              </>
            )}
          </div>

          <div style={{ textAlign: "center" }}>
            <button onClick={completeOnboarding} style={btnPrimary}>
              Go to Dashboard
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
