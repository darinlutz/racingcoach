'use client';

import { useRef, useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import { formatLapTime } from '@/lib/lapData';
import { targetLapParts, uploadTargetLap, type SavedTargetLap } from '@/lib/targetLapUpload';

// The Account page's Target Lap card: one lap CSV saved for the user (racingcoach."Users"."TargetLap"). Drop a
// CSV on it or browse for one, or tick a lap's Target box in Debrief Coach and press Set Target. Shows the
// current Target Lap with Download and Remove.
export default function TargetLapCard({ targetLap: initial }: { targetLap: SavedTargetLap | null }) {
  const { t, fmt, locale } = useLanguage();
  const c = t.targetLap;
  const [targetLap, setTargetLap] = useState(initial);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const save = async (files: FileList | null | undefined) => {
    if (!files || files.length === 0 || busy) return;
    if (files.length > 1) {
      setMessage({ ok: false, text: c.onlyOne });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      setTargetLap(await uploadTargetLap(files[0], t.api.failedSaveTargetLap));
      setMessage({ ok: true, text: c.saved });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : t.api.failedSaveTargetLap });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (busy || !window.confirm(c.removeConfirm)) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/account/target-lap', { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t.api.failedRemoveTargetLap);
      setTargetLap(null);
      setMessage({ ok: true, text: c.removed });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : t.api.failedRemoveTargetLap });
    } finally {
      setBusy(false);
    }
  };

  const parts = targetLap && targetLapParts(targetLap.fileName);

  return (
    <div className="mt-6 bg-card rounded-lg border border-border px-4 py-4">
      <h2 className="text-sm font-medium text-muted-foreground mb-1">{c.title}</h2>
      <p className="text-sm text-muted-foreground mb-3">{c.intro}</p>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void save(e.dataTransfer.files);
        }}
        className={`flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-4 rounded-lg border-2 border-dashed transition-colors ${
          dragging ? 'border-primary bg-accent' : 'border-border bg-secondary'
        }`}
      >
        <p className="text-sm text-muted-foreground text-center sm:text-left">
          {busy ? c.saving : c.drop}
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => fileInputRef.current?.click()}
          className="px-4 py-2 text-sm font-semibold bg-card border border-border rounded-lg text-foreground hover:border-primary hover:text-primary transition-colors disabled:opacity-50"
        >
          {t.laps.browseFiles}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="text/csv,.csv"
          className="hidden"
          aria-label={c.title}
          onChange={(e) => {
            void save(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {targetLap ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 px-4 py-2 bg-secondary border border-border rounded-lg text-sm text-foreground">
          <div className="min-w-0">
            <p className="truncate">
              {parts ? (
                <>
                  {parts.driver} • {parts.car} • {parts.track} •{' '}
                  <span className="font-semibold">{formatLapTime(parts.lapTime)}</span>
                </>
              ) : (
                targetLap.fileName
              )}
            </p>
            <p className="text-xs text-muted-foreground">
              {fmt(c.setOn, { date: new Date(targetLap.setAt).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }) })}
            </p>
          </div>
          <div className="flex gap-2">
            <a
              href="/api/account/target-lap"
              download={targetLap.fileName}
              data-track="download-target-lap"
              className="px-3 py-1 text-xs font-semibold bg-card border border-border rounded-lg text-foreground hover:border-primary hover:text-primary transition-colors"
            >
              {c.download}
            </a>
            <button
              type="button"
              disabled={busy}
              onClick={() => void remove()}
              className="px-3 py-1 text-xs font-semibold bg-card border border-border rounded-lg text-foreground hover:border-primary hover:text-primary transition-colors disabled:opacity-50"
            >
              {c.remove}
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">{c.none}</p>
      )}

      {message && (
        <p role="status" className={`mt-2 text-sm ${message.ok ? 'text-positive' : 'text-red-300'}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
