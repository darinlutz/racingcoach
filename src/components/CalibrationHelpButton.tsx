'use client';

import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';

// Car Data's "How is this used?" button beside Calibrated Cars: a modal explaining that the Rotation Model needs a
// car's calibration before the coaches can tell the driver about understeer and oversteer in it. Styled and animated
// like ConfirmDialog (always rendered, hidden while closed); Escape or a click outside closes it, and focus goes back
// to the button.
export default function CalibrationHelpButton() {
  const t = useLanguage().t.cars;
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const button = buttonRef.current;
    closeRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      button?.focus();
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="inline-flex items-center gap-1.5 px-3 py-1 text-sm font-semibold bg-card border border-border rounded-full text-foreground hover:border-primary hover:text-primary transition-colors"
      >
        <span
          aria-hidden
          className="flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold leading-none text-white"
        >
          ?
        </span>
        {t.calibrationHelpButton}
      </button>

      <div
        aria-hidden={!open}
        onClick={() => setOpen(false)}
        className={`fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 transition-[opacity,visibility] duration-200 ease-out ${
          open ? 'visible opacity-100' : 'invisible opacity-0 pointer-events-none'
        }`}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="calibrationHelpTitle"
          onClick={(e) => e.stopPropagation()}
          className={`relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-card border border-border shadow-xl transition-transform duration-200 ease-out ${
            open ? 'scale-100 translate-y-0' : 'scale-95 translate-y-2'
          }`}
        >
          <div className="h-1.5 rounded-t-xl bg-gradient-to-r from-blue-500 via-primary to-red-500" aria-hidden />
          <div className="p-6 space-y-5">
            <div className="flex items-start gap-4">
              <div
                aria-hidden
                className="shrink-0 flex h-11 w-11 items-center justify-center rounded-full bg-primary/15 text-primary"
              >
                <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 12l4-4" />
                  <path d="M12 3v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M18.4 5.6L17 7" />
                </svg>
              </div>
              <div className="min-w-0 flex-1">
                <h2 id="calibrationHelpTitle" className="text-lg font-bold text-foreground">
                  {t.calibrationHelpTitle}
                </h2>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{t.calibrationHelpIntro}</p>
              </div>
            </div>

            <ol className="space-y-3">
              {t.calibrationHelpPoints.map((point, i) => (
                <li key={point.title} className="flex gap-3 rounded-lg bg-secondary border border-border p-3">
                  <span
                    aria-hidden
                    className="shrink-0 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-white"
                  >
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">{point.title}</p>
                    <p className="text-sm leading-relaxed text-muted-foreground">{point.text}</p>
                  </div>
                </li>
              ))}
            </ol>

            <div className="flex flex-wrap gap-2 text-xs font-bold" aria-hidden>
              <span className="px-2.5 py-1 rounded-full bg-blue-500/15 text-blue-500 border border-blue-500/40">UNDERSTEER</span>
              <span className="px-2.5 py-1 rounded-full bg-red-500/15 text-red-500 border border-red-500/40">OVERSTEER</span>
            </div>

            <p className="text-sm leading-relaxed text-muted-foreground">{t.calibrationHelpUncalibrated}</p>

            <div className="flex justify-end">
              <button
                ref={closeRef}
                type="button"
                onClick={() => setOpen(false)}
                className="px-5 py-2 bg-gradient-to-r from-primary to-primary-strong text-white font-bold rounded-lg hover:shadow-lg hover:shadow-primary/40 transition-all"
              >
                {t.calibrationHelpClose}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
