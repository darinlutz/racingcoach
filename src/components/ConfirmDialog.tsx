'use client';

import { useEffect, useRef, type ReactNode } from 'react';

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
};

// A modal Yes/No box in the site's style, in place of the browser's window.confirm. It fades and scales in and out
// (always rendered, hidden while closed, so closing animates too). Escape or a click outside cancels; Cancel has
// focus when it opens, and focus goes back to whatever had it on close.
export default function ConfirmDialog({ open, title, children, confirmLabel, cancelLabel, onConfirm, onCancel }: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previous?.focus();
    };
  }, [open, onCancel]);

  return (
    <div
      aria-hidden={!open}
      onClick={onCancel}
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 transition-[opacity,visibility] duration-200 ease-out ${
        open ? 'visible opacity-100' : 'invisible opacity-0 pointer-events-none'
      }`}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirmDialogTitle"
        onClick={(e) => e.stopPropagation()}
        className={`w-full max-w-sm rounded-xl bg-card border border-border p-6 shadow-xl transition-transform duration-200 ease-out ${
          open ? 'scale-100 translate-y-0' : 'scale-95 translate-y-2'
        }`}
      >
        <h2 id="confirmDialogTitle" className="text-lg font-bold text-foreground">
          {title}
        </h2>
        {children && <div className="mt-2 text-sm text-muted-foreground">{children}</div>}
        <div className="mt-6 flex flex-col-reverse sm:flex-row gap-3">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="flex-1 px-4 py-2 rounded-lg font-semibold text-foreground bg-card border border-border hover:bg-secondary transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex-1 px-4 py-2 rounded-lg font-semibold text-white bg-red-600 hover:bg-red-700 transition-colors"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
