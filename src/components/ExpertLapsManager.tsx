'use client';

import { useCallback, useRef, useState } from 'react';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useLanguage } from '@/components/LanguageProvider';
import type { ExpertLapInfo } from '@/lib/expertLaps';
import { formatLapTime } from '@/lib/lapData';

type Message = { ok: boolean; text: string };

const byTrackAndCar = (a: ExpertLapInfo, b: ExpertLapInfo) =>
  a.track.localeCompare(b.track, undefined, { sensitivity: 'base' }) ||
  a.car.localeCompare(b.car, undefined, { sensitivity: 'base' });

// The Coach page's Expert Laps section: lap CSVs dropped on it (or browsed for) are saved as the Expert Lap of
// their car and track (POST /api/coach/expert-laps, src/lib/expertLaps.ts). Several files go one at a time; when
// one's car and track already has an Expert Lap, a modal asks whether to replace it, and the upload waits for
// the answer. Lists the Expert Laps with Set Target (copies it into the user's own Target Lap), Download and
// Remove. readOnly (the nav bar's Expert Laps page, for every signed-in user) lists them with Set Target only.
export default function ExpertLapsManager({ expertLaps: initial, readOnly = false }: { expertLaps: ExpertLapInfo[]; readOnly?: boolean }) {
  const { t, fmt, locale } = useLanguage();
  const c = t.coach;
  const [expertLaps, setExpertLaps] = useState(initial);
  const [dragging, setDragging] = useState(false);
  const [busyFile, setBusyFile] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [replacing, setReplacing] = useState<{ existing: ExpertLapInfo; answer: (replace: boolean) => void } | null>(null);
  const [removing, setRemoving] = useState<ExpertLapInfo | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const busy = busyFile !== null;

  const names = (lap: ExpertLapInfo) => ({ car: lap.car, track: lap.track });

  // Opens the replace modal and resolves with the answer
  const askReplace = (existing: ExpertLapInfo) =>
    new Promise<boolean>((resolve) => {
      setReplacing({
        existing,
        answer: (replace) => {
          setReplacing(null);
          resolve(replace);
        },
      });
    });
  // Stable, so the dialogs' Escape listeners aren't re-added on every render
  const answerNo = useCallback(() => replacing?.answer(false), [replacing]);
  const closeRemove = useCallback(() => setRemoving(null), []);

  const upload = async (file: File, replace: boolean): Promise<{ status: number; data: Record<string, unknown> }> => {
    const form = new FormData();
    form.append('file', file);
    if (replace) form.append('replace', 'true');
    const res = await fetch('/api/coach/expert-laps', { method: 'POST', body: form });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };

  const saveOne = async (file: File): Promise<Message> => {
    try {
      let { status, data } = await upload(file, false);
      let replaced = false;
      if (status === 409 && data.existing) {
        const existing = data.existing as ExpertLapInfo;
        if (!(await askReplace(existing))) return { ok: true, text: fmt(c.expertLapsKept, names(existing)) };
        ({ status, data } = await upload(file, true));
        replaced = true;
      }
      if (status < 200 || status >= 300 || !data.expertLap) {
        return { ok: false, text: `${file.name}: ${(data.error as string) || t.api.failedSaveExpertLap}` };
      }
      const saved = data.expertLap as ExpertLapInfo;
      setExpertLaps((laps) => [...laps.filter((lap) => lap.id !== saved.id), saved].sort(byTrackAndCar));
      return { ok: true, text: fmt(replaced ? c.expertLapsReplaced : c.expertLapsSaved, names(saved)) };
    } catch {
      return { ok: false, text: `${file.name}: ${t.api.failedSaveExpertLap}` };
    }
  };

  const save = async (files: FileList | null | undefined) => {
    if (!files || files.length === 0 || busy) return;
    const list = Array.from(files);
    setMessages([]);
    try {
      for (const file of list) {
        setBusyFile(file.name);
        const message = await saveOne(file);
        setMessages((previous) => [...previous, message]);
      }
    } finally {
      setBusyFile(null);
    }
  };

  const remove = async () => {
    const lap = removing;
    setRemoving(null);
    if (!lap || busy) return;
    setBusyFile(lap.fileName);
    setMessages([]);
    try {
      const res = await fetch(`/api/coach/expert-laps/${lap.id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t.api.failedRemoveExpertLap);
      setExpertLaps((laps) => laps.filter((other) => other.id !== lap.id));
      setMessages([{ ok: true, text: fmt(c.expertLapsRemoved, names(lap)) }]);
    } catch (err) {
      setMessages([{ ok: false, text: err instanceof Error ? err.message : t.api.failedRemoveExpertLap }]);
    } finally {
      setBusyFile(null);
    }
  };

  const setTarget = async (lap: ExpertLapInfo) => {
    if (busy) return;
    setBusyFile(lap.fileName);
    setMessages([]);
    try {
      const res = await fetch(`/api/coach/expert-laps/${lap.id}/target`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t.api.failedSaveTargetLap);
      setMessages([{ ok: true, text: fmt(c.expertLapsTargetSet, names(lap)) }]);
    } catch (err) {
      setMessages([{ ok: false, text: err instanceof Error ? err.message : t.api.failedSaveTargetLap }]);
    } finally {
      setBusyFile(null);
    }
  };

  const buttonClass =
    'px-3 py-1 text-xs font-semibold bg-card border border-border rounded-lg text-foreground hover:border-primary hover:text-primary transition-colors disabled:opacity-50';

  return (
    <div className="bg-secondary rounded-xl border border-border p-4 sm:p-6">
      <h2 className="text-xl font-bold text-foreground mb-1">{c.expertLapsTitle}</h2>
      <p className="text-sm text-muted-foreground mb-4">{readOnly ? c.expertLapsViewIntro : c.expertLapsIntro}</p>

      {!readOnly && (
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
        className={`flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-6 rounded-lg border-2 border-dashed transition-colors ${
          dragging ? 'border-primary bg-accent' : 'border-border bg-card'
        }`}
      >
        <p className="text-sm text-muted-foreground text-center sm:text-left">
          {busyFile ? fmt(c.expertLapsSaving, { file: busyFile }) : c.expertLapsDrop}
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
          multiple
          className="hidden"
          aria-label={c.expertLapsTitle}
          onChange={(e) => {
            void save(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
      )}

      {messages.length > 0 && (
        <div role="status" className="mt-3 space-y-1">
          {messages.map((message, i) => (
            <p key={i} className={`text-sm ${message.ok ? 'text-positive' : 'text-red-300'}`}>
              {message.text}
            </p>
          ))}
        </div>
      )}

      {expertLaps.length > 0 ? (
        <div className="mt-4 overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm text-left">
            <thead className="bg-card text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">{c.expertLapsTrack}</th>
                <th className="px-3 py-2 font-medium">{c.expertLapsCar}</th>
                <th className="px-3 py-2 font-medium">{c.expertLapsDriver}</th>
                <th className="px-3 py-2 font-medium">{c.expertLapsLapTime}</th>
                <th className="px-3 py-2 font-medium">{c.expertLapsUploaded}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {expertLaps.map((lap) => (
                <tr key={lap.id} className="text-foreground">
                  <td className="px-3 py-2">{lap.track}</td>
                  <td className="px-3 py-2">{lap.car}</td>
                  <td className="px-3 py-2">{lap.driver}</td>
                  <td className="px-3 py-2 font-semibold tabular-nums">{formatLapTime(lap.lapTime)}</td>
                  <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                    {new Date(lap.uploadedAt).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void setTarget(lap)}
                        data-track="set-target-expert-lap"
                        className={
                          readOnly
                            ? 'px-3 py-1 text-xs font-semibold bg-card border border-border rounded-lg text-foreground hover:bg-green-600 hover:border-green-600 hover:text-white transition-colors whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed'
                            : 'px-3 py-1 text-xs font-semibold rounded-lg text-white bg-green-600 hover:bg-green-700 transition-colors whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed'
                        }
                      >
                        {c.expertLapsSetTarget}
                      </button>
                      {!readOnly && (
                      <>
                      <a
                        href={`/api/coach/expert-laps/${lap.id}`}
                        download={lap.fileName}
                        data-track="download-expert-lap"
                        className={buttonClass}
                      >
                        {c.expertLapsDownload}
                      </a>
                      <button type="button" disabled={busy} onClick={() => setRemoving(lap)} className={buttonClass}>
                        {c.expertLapsRemove}
                      </button>
                      </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">{c.expertLapsNone}</p>
      )}

      <ConfirmDialog
        open={replacing !== null}
        title={c.expertLapsExistsTitle}
        confirmLabel={c.expertLapsYes}
        cancelLabel={c.expertLapsNo}
        onConfirm={() => replacing?.answer(true)}
        onCancel={answerNo}
      >
        {replacing && (
          <>
            <p>{fmt(c.expertLapsExists, names(replacing.existing))}</p>
            <p className="mt-2 text-xs">
              {replacing.existing.driver} • {formatLapTime(replacing.existing.lapTime)}
            </p>
          </>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={removing !== null}
        title={c.expertLapsRemoveConfirm}
        confirmLabel={c.expertLapsRemove}
        cancelLabel={t.common.cancel}
        onConfirm={() => void remove()}
        onCancel={closeRemove}
      >
        {removing && `${removing.car} • ${removing.track} • ${formatLapTime(removing.lapTime)}`}
      </ConfirmDialog>
    </div>
  );
}
