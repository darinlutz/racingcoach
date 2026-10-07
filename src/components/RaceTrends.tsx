'use client';

import { useRef, useState } from 'react';

import IRatingChart from '@/components/IRatingChart';
import { formatSize } from '@/lib/lapData';
import { driversByAppearances, parseResultFile, raceEventsFor, type ResultFile } from '@/lib/raceResults';
import type { IRatingSeries } from '@/lib/raceTrends';

export default function RaceTrends() {
  const [resultFiles, setResultFiles] = useState<ResultFile[]>([]);
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [custId, setCustId] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [trend, setTrend] = useState<IRatingSeries[] | null>(null);
  const [commentary, setCommentary] = useState('');
  const [steps, setSteps] = useState<string[]>([]);
  const [runError, setRunError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // You are normally the one driver in every uploaded file; anyone else in all of them can be picked instead
  const drivers = driversByAppearances(resultFiles);
  const candidates = drivers.filter((d) => d.files === drivers[0]?.files);
  const driver = candidates.find((d) => d.custId === custId) ?? candidates[0];

  const handleFiles = async (fileList: FileList | null | undefined) => {
    if (!fileList || fileList.length === 0) return;

    const files = Array.from(fileList);
    const results = await Promise.allSettled(files.map(parseResultFile));
    const added: ResultFile[] = [];
    const errors: string[] = [];

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') added.push(result.value);
      else errors.push(`${files[index].name}: ${(result.reason as Error).message}`);
    });

    setFileErrors(errors);
    // Skip events that were already added (same subsession ID), oldest first
    setResultFiles((prev) =>
      [...prev, ...added.filter((f, i) => !prev.some((p) => p.fileId === f.fileId) && added.findIndex((a) => a.fileId === f.fileId) === i)].sort(
        (a, b) => a.startTime.localeCompare(b.startTime)
      )
    );
  };

  const removeFile = (fileId: string) => {
    setResultFiles((prev) => prev.filter((f) => f.fileId !== fileId));
  };

  const getTrends = async () => {
    if (!driver) return;
    setRunning(true);
    setRunError('');
    setTrend(null);
    setCommentary('');
    setSteps([]);
    try {
      const res = await fetch('/api/race-trends', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driver: driver.name, events: raceEventsFor(resultFiles, driver.custId) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to get the race trends');
      setTrend(data.trend);
      setCommentary(data.commentary);
      setSteps(data.steps);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : 'unknown error');
    } finally {
      setRunning(false);
    }
  };

  const inputClass =
    'w-full px-4 py-3 bg-white border border-slate-300 rounded-lg text-dark-blue focus:outline-none focus:border-powder-600 focus:ring-1 focus:ring-powder-500 transition-colors';

  return (
    <div className="bg-slate-50 rounded-xl border border-slate-200 p-8 space-y-6">
      {/* File upload */}
      <div>
        <label className="block text-sm text-slate-600 mb-2">Upload your iRacing event result JSON files</label>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void handleFiles(e.dataTransfer.files);
          }}
          className={`flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-4 rounded-lg border-2 border-dashed transition-colors ${
            dragging ? 'border-powder-500 bg-powder-50' : 'border-slate-300 bg-white'
          }`}
        >
          <div className="text-sm text-slate-600 text-center sm:text-left">
            <p className="font-medium text-dark-blue">Drag and drop files here</p>
            <p>Limit 25MB per file • JSON • Multiple files</p>
          </div>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="px-4 py-2 text-sm font-semibold bg-white border border-slate-300 rounded-lg text-dark-blue hover:border-powder-600 hover:text-powder-600 transition-colors"
          >
            Browse files
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            multiple
            className="hidden"
            onChange={(e) => {
              void handleFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </div>

        {fileErrors.length > 0 && (
          <div className="mt-2 px-4 py-3 rounded-lg border text-sm whitespace-pre-wrap bg-red-50 border-red-200 text-red-900">
            {fileErrors.join('\n')}
          </div>
        )}

        {resultFiles.length > 0 && (
          <>
            <div className="mt-2 flex items-center justify-between text-sm text-slate-600">
              <span>
                {resultFiles.length} {resultFiles.length === 1 ? 'event' : 'events'} uploaded
              </span>
              <button type="button" onClick={() => setResultFiles([])} className="text-slate-500 hover:text-red-600">
                Clear all
              </button>
            </div>
            <ul className="mt-2 space-y-2 max-h-72 overflow-y-auto">
              {resultFiles.map((f) => (
                <li
                  key={f.fileId}
                  className="flex items-center justify-between px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm text-dark-blue"
                >
                  <span className="min-w-0 truncate">
                    📄 <span className="text-slate-500">{new Date(f.startTime).toLocaleDateString('en-US')}</span> {f.seriesName}{' '}
                    • {f.trackName} <span className="text-slate-500">{formatSize(f.file.size)}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => removeFile(f.fileId)}
                    aria-label={`Remove ${f.file.name}`}
                    className="ml-3 text-slate-500 hover:text-red-600"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {candidates.length > 1 && (
        <div>
          <label htmlFor="race-trends-driver" className="block text-sm font-medium text-dark-blue mb-2">
            Driver
          </label>
          <select
            id="race-trends-driver"
            value={driver?.custId ?? ''}
            onChange={(e) => setCustId(Number(e.target.value))}
            className={inputClass}
          >
            {candidates.map((d) => (
              <option key={d.custId} value={d.custId}>
                {d.name}
              </option>
            ))}
          </select>
          <p className="mt-2 text-sm text-slate-500">
            More than one driver is in every uploaded file, so pick yourself. Upload more events to narrow it down.
          </p>
        </div>
      )}

      <div className="space-y-4">
        <button
          type="button"
          onClick={() => void getTrends()}
          disabled={!driver || running}
          className="px-6 py-3 font-semibold text-white bg-gradient-to-r from-powder-500 to-powder-600 rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {running ? 'Analyzing your races…' : 'Get Trends'}
        </button>

        {runError && (
          <div className="px-4 py-3 rounded-lg border text-sm bg-red-50 border-red-200 text-red-900">
            Failed: {runError}
          </div>
        )}

        {!trend && !runError && !running && (
          <p className="text-sm text-slate-500">
            {driver
              ? `Press Get Trends to see ${driver.name}'s iRating over time.`
              : 'Upload your event result JSON files, then press Get Trends.'}
          </p>
        )}

        {trend && (
          <div className="space-y-4">
            {trend.length > 0 ? (
              <IRatingChart trend={trend} />
            ) : (
              <p className="text-sm text-slate-600">None of these events counted for iRating.</p>
            )}
            <p className="text-xs text-slate-500">
              Each point is your iRating after a race. iRacing keeps a separate iRating for each license category, so
              each category gets its own line. Unofficial races (such as 13th week series) don&apos;t change iRating and
              are left out of the chart.
            </p>

            {commentary && trend.length > 0 && (
              <div className="px-5 py-4 bg-white border border-slate-200 rounded-lg">
                <h3 className="font-bold text-dark-blue mb-2">Commentary</h3>
                <p className="text-sm text-slate-700 whitespace-pre-wrap">{commentary}</p>
              </div>
            )}

            {steps.length > 0 && (
              <details className="text-sm text-slate-600">
                <summary className="cursor-pointer">What the agent checked ({steps.length} steps)</summary>
                <ol className="mt-2 list-decimal pl-5 space-y-1 font-mono text-xs">
                  {steps.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
              </details>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
