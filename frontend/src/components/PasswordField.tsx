import { getPasswordStrength, PASSWORD_REQUIREMENTS, type PasswordStrength } from "../utils/password";

type PasswordFieldProps = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
  required?: boolean;
  autoComplete?: string;
  disabled?: boolean;
  showRequirements?: boolean;
  showStrength?: boolean;
  minLength?: number;
  style?: React.CSSProperties;
  inputStyle?: React.CSSProperties;
};

const strengthConfig: Record<NonNullable<PasswordStrength>, { label: string; color: string; bgColor: string }> = {
  weak: { label: "Weak", color: "#ef4444", bgColor: "rgba(239,68,68,0.2)" },
  fair: { label: "Fair", color: "#f59e0b", bgColor: "rgba(245,158,11,0.2)" },
  good: { label: "Good", color: "#22c55e", bgColor: "rgba(34,197,94,0.2)" },
  strong: { label: "Strong", color: "#2dd4bf", bgColor: "rgba(45,212,191,0.2)" },
};

export default function PasswordField({
  id,
  value,
  onChange,
  label = "Password",
  placeholder = "Enter password",
  required = true,
  autoComplete = "new-password",
  disabled = false,
  showRequirements = true,
  showStrength = true,
  minLength = 8,
  style,
  inputStyle,
}: PasswordFieldProps) {
  const strength = getPasswordStrength(value);

  return (
    <div className="form-group" style={style}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        minLength={minLength}
        autoComplete={autoComplete}
        disabled={disabled}
        style={inputStyle}
      />
      {showRequirements && (
        <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.25rem", fontSize: "0.85rem", color: "var(--text-muted)", lineHeight: 1.6 }}>
          {PASSWORD_REQUIREMENTS.map((req) => (
            <li key={req}>{req}</li>
          ))}
        </ul>
      )}
      {showStrength && value && strength && (
        <div style={{ marginTop: "0.5rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span
            style={{
              fontSize: "0.8rem",
              fontWeight: 600,
              color: strengthConfig[strength].color,
              padding: "0.2rem 0.5rem",
              borderRadius: 4,
              background: strengthConfig[strength].bgColor,
            }}
          >
            {strengthConfig[strength].label}
          </span>
          <div style={{ flex: 1, maxWidth: 120, height: 4, background: "var(--bg-subtle)", borderRadius: 2, overflow: "hidden" }}>
            <div
              style={{
                width: strength === "weak" ? "25%" : strength === "fair" ? "50%" : strength === "good" ? "75%" : "100%",
                height: "100%",
                background: strengthConfig[strength].color,
                transition: "width 0.2s",
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
