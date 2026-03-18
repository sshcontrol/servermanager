type ToggleProps = {
  id?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  "aria-label"?: string;
};

export default function Toggle({
  id,
  checked,
  onChange,
  disabled = false,
  "aria-label": ariaLabel,
}: ToggleProps) {
  return (
    <label className="toggle-switch" htmlFor={id}>
      <input
        type="checkbox"
        id={id}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        aria-label={ariaLabel}
      />
      <span className="toggle-slider" />
    </label>
  );
}
