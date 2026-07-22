"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { GameIcon } from "@/components/GameIcon";

interface AppModalProps {
  children: ReactNode;
  compact?: boolean;
  eyebrow?: string;
  icon?: ReactNode;
  onClose: () => void;
  position?: "center" | "upper";
  title: string;
  variant?: "account" | "default" | "leaderboard" | "online" | "result" | "rules" | "sound";
  wide?: boolean;
}

export function AppModal({
  children,
  compact = false,
  eyebrow,
  icon,
  onClose,
  position = "center",
  title,
  variant = "default",
  wide = false,
}: AppModalProps) {
  const panelRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onCloseRef.current();
      if (event.key !== "Tab" || !panelRef.current) return;

      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    window.requestAnimationFrame(() => panelRef.current?.focus());
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
      previousFocus?.focus();
    };
  }, []);

  return (
    <div
      aria-label="Затвори прозор"
      className={`modal-overlay modal-overlay--${variant} ${position === "upper" ? "modal-overlay--upper" : ""}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="presentation"
    >
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className={`modal-panel modal-panel--${variant} ${wide ? "modal-panel--wide" : ""} ${compact ? "modal-panel--compact" : ""}`}
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="modal-header">
          {icon && <span className="modal-header__icon" aria-hidden="true">{icon}</span>}
          <div className="modal-header__copy">
            {eyebrow && <p>{eyebrow}</p>}
            <h2 id={titleId}>{title}</h2>
          </div>
          <button aria-label="Затвори" className="modal-close" onClick={onClose} type="button">
            <GameIcon name="close" />
          </button>
        </header>
        <div className="modal-content">{children}</div>
      </section>
    </div>
  );
}
