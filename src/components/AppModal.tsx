"use client";

import { useEffect, type ReactNode } from "react";

interface AppModalProps {
  children: ReactNode;
  eyebrow: string;
  onClose: () => void;
  position?: "center" | "upper";
  title: string;
  wide?: boolean;
}

export function AppModal({ children, eyebrow, onClose, position = "center", title, wide = false }: AppModalProps) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  return (
    <div
      aria-label="Затвори прозор"
      className={`modal-overlay ${position === "upper" ? "modal-overlay--upper" : ""}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="presentation"
    >
      <section
        aria-labelledby="modal-title"
        aria-modal="true"
        className={`modal-panel ${wide ? "modal-panel--wide" : ""}`}
        role="dialog"
      >
        <header className="modal-header">
          <div>
            <p>{eyebrow}</p>
            <h2 id="modal-title">{title}</h2>
          </div>
          <button aria-label="Затвори" className="modal-close" onClick={onClose} type="button">
            <span aria-hidden="true">×</span>
          </button>
        </header>
        <div className="modal-content">{children}</div>
      </section>
    </div>
  );
}
