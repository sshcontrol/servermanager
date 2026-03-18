import { createContext, useCallback, useContext, useState, useRef, type ReactNode } from "react";
import SuccessConfirmModal from "./SuccessConfirmModal";

type ToastType = "success" | "error" | "info";

interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
}

interface ToastCtx {
  toast: (type: ToastType, message: string) => void;
  showSuccessModal: (message?: string, title?: string) => void;
}

const Ctx = createContext<ToastCtx>({ toast: () => {}, showSuccessModal: () => {} });

export function useToast() {
  return useContext(Ctx);
}

const ICONS: Record<ToastType, ReactNode> = {
  success: (
    <svg className="toast-icon toast-icon-success" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
  ),
  error: (
    <svg className="toast-icon toast-icon-error" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="15" x2="9" y1="9" y2="15" /><line x1="9" x2="15" y1="9" y2="15" /></svg>
  ),
  info: (
    <svg className="toast-icon toast-icon-info" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></svg>
  ),
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const [successModal, setSuccessModal] = useState<{ open: boolean; message?: string; title?: string }>({ open: false });
  const counter = useRef(0);

  const toast = useCallback((type: ToastType, message: string) => {
    const id = ++counter.current;
    setItems((prev) => [...prev, { id, type, message }]);
    setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  const showSuccessModal = useCallback((message?: string, title?: string) => {
    setSuccessModal({ open: true, message, title });
  }, []);

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <Ctx.Provider value={{ toast, showSuccessModal }}>
      {children}
      <div className="toast-container" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast toast-${t.type}`}>
            {ICONS[t.type]}
            <div className="toast-body">{t.message}</div>
            <button type="button" className="toast-close" onClick={() => dismiss(t.id)} aria-label="Dismiss">
              &times;
            </button>
          </div>
        ))}
      </div>
      <SuccessConfirmModal
        open={successModal.open}
        title={successModal.title}
        message={successModal.message}
        onClose={() => setSuccessModal((s) => ({ ...s, open: false }))}
      />
    </Ctx.Provider>
  );
}
