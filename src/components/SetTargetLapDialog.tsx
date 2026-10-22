'use client';

import { useEffect, useRef } from 'react';
import { CheckCircle2, Target } from 'lucide-react';
import { useLanguage } from '@/components/LanguageProvider';
import { formatLapTime } from '@/lib/lapData';
import { targetLapParts } from '@/lib/targetLapUpload';

export type SetTargetLapStep = 'confirm' | 'saving' | 'saved';

type SetTargetLapDialogProps = {
  open: boolean;
  step: SetTargetLapStep;
  // The lap's file name ("RacingCoach - Driver - Car - Track - 01.50.486 - S0L005.csv"), shown as its parts
  fileName: string;
  error: string;
  onConfirm: () => void;
  onClose: () => void;
};

// Debrief Coach's confirmation for Set Target and Set as Target, in place of the browser's window.confirm: asks
// first, stays open while the lap saves, then says it's set. Fades and scales like ConfirmDialog (always rendered,
// hidden while closed); Escape or a click outside closes it unless the lap is saving, and focus goes back to
// whatever had it on close.
export default function SetTargetLapDialog({ open, step, fileName, error, onConfirm, onClose }: SetTargetLapDialogProps) {
  const { t } = useLanguage();
  const d = t.setTargetDialog;
  const focusRef = useRef<HTMLButtonElement>(null);
  const saving = step === 'saving';
  const parts = targetLapParts(fileName);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    return () => previous?.focus();
  }, [open]);

  // Cancel has focus when it opens, Done once the lap is set
  useEffect(() => {
    if (open) focusRef.current?.focus();
  }, [open, step]);

  useEffect(() => {
    if (!open || saving) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, saving, onClose]);

  const details = parts
    ? [
        [d.driver, parts.driver],
        [d.car, parts.car],
        [d.track, parts.track],
        [d.lapTime, formatLapTime(parts.lapTime)],
      ]
    : [[d.lap, fileName]];

  return (
    <div
      aria-hidden={!open}
      onClick={() => !saving && onClose()}
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 transition-[opacity,visibility] duration-200 ease-out ${
        open ? 'visible opacity-100' : 'invisible opacity-0 pointer-events-none'
      }`}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="setTargetLapTitle"
        onClick={(e) => e.stopPropagation()}
        className={`w-full max-w-md rounded-xl bg-card border border-border p-6 shadow-xl transition-transform duration-200 ease-out ${
          open ? 'scale-100 translate-y-0' : 'scale-95 translate-y-2'
        }`}
      >
        <div className="flex items-center gap-3">
          <span
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
              step === 'saved' ? 'bg-positive/15 text-positive' : 'bg-primary/15 text-primary'
            }`}
          >
            {step === 'saved' ? <CheckCircle2 className="h-6 w-6" aria-hidden /> : <Target className="h-6 w-6" aria-hidden />}
          </span>
          <h2 id="setTargetLapTitle" className="text-lg font-bold text-foreground">
            {step === 'saved' ? d.savedTitle : d.title}
          </h2>
        </div>

        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{step === 'saved' ? d.savedText : d.intro}</p>

        <dl className="mt-4 rounded-lg border border-border bg-secondary px-4 py-3 text-sm space-y-1.5">
          {details.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4">
              <dt className="shrink-0 text-muted-foreground">{label}</dt>
              <dd className="min-w-0 text-right font-medium text-foreground break-words">{value}</dd>
            </div>
          ))}
        </dl>

        {error && step === 'confirm' && (
          <div role="alert" className="mt-4 px-4 py-3 rounded-lg border text-sm bg-primary/10 border-primary/40 text-red-300">
            {error}
          </div>
        )}

        {step === 'saved' ? (
          <div className="mt-6">
            <button
              ref={focusRef}
              type="button"
              onClick={onClose}
              className="w-full px-4 py-2 rounded-lg font-semibold text-white bg-gradient-to-r from-primary to-primary-strong hover:opacity-90 transition-opacity"
            >
              {d.done}
            </button>
          </div>
        ) : (
          <div className="mt-6 flex flex-col-reverse sm:flex-row gap-3">
            <button
              ref={focusRef}
              type="button"
              onClick={onClose}
              disabled={saving}
              className="flex-1 px-4 py-2 rounded-lg font-semibold text-foreground bg-card border border-border hover:bg-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t.common.cancel}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={saving}
              data-track="confirm-set-target-lap"
              className="flex-1 px-4 py-2 rounded-lg font-semibold text-white bg-green-600 hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? d.saving : d.confirm}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
