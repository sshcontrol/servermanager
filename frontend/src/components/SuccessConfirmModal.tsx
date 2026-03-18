import { useEffect, useRef } from "react";

type Props = {
  open: boolean;
  title?: string;
  message?: string;
  onClose: () => void;
};

export default function SuccessConfirmModal({
  open,
  title = "Success",
  message = "Changes submitted successfully.",
  onClose,
}: Props) {
  const okRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) {
      okRef.current?.focus();
      const handler = (e: KeyboardEvent) => {
        if (e.key === "Escape" || e.key === "Enter") onClose();
      };
      document.addEventListener("keydown", handler);
      return () => document.removeEventListener("keydown", handler);
    }
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="confirm-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="success-modal-title"
    >
      <div className="confirm-dialog success-confirm-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="success-confirm-icon" aria-hidden>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </div>
        <div id="success-modal-title" className="confirm-title">{title}</div>
        <div className="confirm-message">{message}</div>
        <div className="confirm-actions" style={{ justifyContent: "center" }}>
          <button ref={okRef} type="button" className="primary" onClick={onClose}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
