'use client';

import { Fragment, useEffect, useState } from 'react';
import Link from 'next/link';
import type { TrackInput, UserTrack } from '@/lib/tracks';

// Matches MAX_FOCUS_AREAS in lib/tracks (not imported: that module is server-only)
const MAX_FOCUS_AREAS = 8;

// Form values are kept as typed text and converted when the track is saved
type AreaDraft = {
  uid: number;
  name: string;
  startPoint: string;
  endPoint: string;
  brakePointFeet: string;
  maxBrakePct: string;
  throttlePointFeet: string;
  notes: string;
};

type TrackDraft = {
  id: number | null;
  name: string;
  key: string;
  lengthFeet: string;
  notes: string;
  areas: AreaDraft[];
};

let nextUid = 1;

const asText = (value: number | null) => (value === null ? '' : String(value));

function toDraft(track: UserTrack | null): TrackDraft {
  if (!track) return { id: null, name: '', key: '', lengthFeet: '', notes: '', areas: [] };
  return {
    id: track.id,
    name: track.name,
    key: track.key === track.name ? '' : track.key,
    lengthFeet: asText(track.lengthFeet),
    notes: track.notes ?? '',
    areas: track.areas.map((a) => ({
      uid: nextUid++,
      name: a.name,
      startPoint: String(a.startPoint),
      endPoint: String(a.endPoint),
      brakePointFeet: asText(a.brakePointFeet),
      maxBrakePct: asText(a.maxBrakePct),
      throttlePointFeet: asText(a.throttlePointFeet),
      notes: a.notes ?? '',
    })),
  };
}

// '' -> null; otherwise a number, or an error naming the field
function parseNumber(text: string, label: string, integer: boolean): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || (integer && !Number.isInteger(value))) {
    throw new Error(`${label} must be a ${integer ? 'whole number' : 'number'}`);
  }
  return value;
}

function toInput(draft: TrackDraft): TrackInput {
  return {
    name: draft.name,
    key: draft.key,
    lengthFeet: parseNumber(draft.lengthFeet, 'Track length', true),
    notes: draft.notes,
    areas: draft.areas.map((a, i) => {
      const label = a.name.trim() || `Focus area ${i + 1}`;
      const startPoint = parseNumber(a.startPoint, `${label}: start`, false);
      const endPoint = parseNumber(a.endPoint, `${label}: end`, false);
      if (startPoint === null || endPoint === null) throw new Error(`${label}: start and end are required`);
      return {
        name: a.name,
        startPoint,
        endPoint,
        notes: a.notes,
        brakePointFeet: parseNumber(a.brakePointFeet, `${label}: brake point`, true),
        maxBrakePct: parseNumber(a.maxBrakePct, `${label}: max brake pressure`, true),
        throttlePointFeet: parseNumber(a.throttlePointFeet, `${label}: on-throttle point`, true),
      };
    }),
  };
}

const target = (value: number | null, unit: string) => (value === null ? '—' : `${value.toLocaleString('en-US')}${unit}`);

const inputClass =
  'w-full px-3 py-2 bg-card border border-border rounded-lg text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors';
const cellInputClass =
  'w-full px-2 py-1.5 bg-card border border-border rounded text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary';
const primaryButton =
  'px-4 py-2 bg-gradient-to-r from-primary to-primary-strong text-white font-bold rounded-lg hover:shadow-lg hover:shadow-primary/40 transition-all disabled:opacity-50 disabled:cursor-not-allowed';
const secondaryButton =
  'px-4 py-2 text-sm font-semibold bg-card border border-border rounded-lg text-foreground hover:border-primary hover:text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

export default function TrackManagement() {
  const [tracks, setTracks] = useState<UserTrack[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [message, setMessage] = useState('');
  const [draft, setDraft] = useState<TrackDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => {
    fetch('/api/tracks')
      .then((response) => {
        if (response.status === 401) {
          setSignedOut(true);
          return { tracks: [] };
        }
        return response.json();
      })
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setTracks(data.tracks ?? []);
      })
      .catch(() => setMessage('Failed to load tracks'))
      .finally(() => setLoaded(true));
  }, []);

  if (signedOut) {
    return (
      <div className="bg-secondary rounded-xl border border-border p-8 text-muted-foreground">
        <Link href="/login" className="font-semibold text-primary hover:underline">
          Log in
        </Link>{' '}
        to see and manage your tracks.
      </div>
    );
  }

  const updateDraft = (changes: Partial<TrackDraft>) => setDraft((d) => (d ? { ...d, ...changes } : d));
  const updateArea = (uid: number, changes: Partial<AreaDraft>) =>
    setDraft((d) => (d ? { ...d, areas: d.areas.map((a) => (a.uid === uid ? { ...a, ...changes } : a)) } : d));

  const addArea = () =>
    setDraft((d) =>
      d && d.areas.length < MAX_FOCUS_AREAS
        ? {
            ...d,
            areas: [
              ...d.areas,
              {
                uid: nextUid++,
                name: '',
                startPoint: '',
                endPoint: '',
                brakePointFeet: '',
                maxBrakePct: '',
                throttlePointFeet: '',
                notes: '',
              },
            ],
          }
        : d
    );

  const removeArea = (uid: number) => setDraft((d) => (d ? { ...d, areas: d.areas.filter((a) => a.uid !== uid) } : d));

  const startEditing = (track: UserTrack | null) => {
    setMessage('');
    setDraft(toDraft(track));
  };

  const saveTrack = async () => {
    if (!draft) return;
    setMessage('');
    let track: TrackInput;
    try {
      track = toInput(draft);
    } catch (error) {
      setMessage((error as Error).message);
      return;
    }

    setSaving(true);
    try {
      const response = await fetch('/api/tracks', {
        method: draft.id === null ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft.id === null ? { track } : { id: draft.id, track }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to save track');
      setTracks(data.tracks);
      setExpanded(draft.id ?? data.id);
      setDraft(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to save track');
    } finally {
      setSaving(false);
    }
  };

  const removeTrack = async (track: UserTrack) => {
    if (!window.confirm(`Delete ${track.name} and its ${track.areas.length} focus areas?`)) return;
    setMessage('');
    try {
      const response = await fetch('/api/tracks', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: track.id }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to delete track');
      setTracks((prev) => prev.filter((t) => t.id !== track.id));
      if (draft?.id === track.id) setDraft(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to delete track');
    }
  };

  return (
    <div className="bg-secondary rounded-xl border border-border p-8 space-y-6">
      {message && (
        <div className="p-3 rounded-lg bg-primary/15 border border-primary/40 text-red-300 text-sm">{message}</div>
      )}

      {/* Track editor */}
      {draft ? (
        <div className="bg-card border border-border rounded-lg p-6 space-y-5">
          <h3 className="text-lg font-bold text-foreground">{draft.id === null ? 'Add Track' : `Edit ${draft.name || 'Track'}`}</h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="track-name" className="block text-sm font-medium text-foreground mb-1">
                Track Name
              </label>
              <input
                id="track-name"
                type="text"
                value={draft.name}
                onChange={(e) => updateDraft({ name: e.target.value })}
                placeholder="e.g. Road Atlanta (Full Course)"
                className={inputClass}
              />
              <p className="mt-1 text-xs text-muted-foreground">As it appears in your Garage 61 CSV file names.</p>
            </div>
            <div>
              <label htmlFor="track-key" className="block text-sm font-medium text-foreground mb-1">
                Track Key <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <input
                id="track-key"
                type="text"
                value={draft.key}
                onChange={(e) => updateDraft({ key: e.target.value })}
                placeholder="e.g. roadatlanta full"
                className={inputClass}
              />
              <p className="mt-1 text-xs text-muted-foreground">The iRacing track key. Left blank, the track name is used.</p>
            </div>
            <div>
              <label htmlFor="track-length" className="block text-sm font-medium text-foreground mb-1">
                Track Length (feet) <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <input
                id="track-length"
                type="text"
                inputMode="numeric"
                value={draft.lengthFeet}
                onChange={(e) => updateDraft({ lengthFeet: e.target.value })}
                placeholder="e.g. 13411"
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="track-notes" className="block text-sm font-medium text-foreground mb-1">
                Notes <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <input
                id="track-notes"
                type="text"
                value={draft.notes}
                onChange={(e) => updateDraft({ notes: e.target.value })}
                className={inputClass}
              />
            </div>
          </div>

          {/* Focus areas */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-foreground">
                Focus Areas{' '}
                <span className="font-normal text-muted-foreground">
                  ({draft.areas.length} of {MAX_FOCUS_AREAS})
                </span>
              </p>
              <button
                type="button"
                onClick={addArea}
                disabled={draft.areas.length >= MAX_FOCUS_AREAS}
                className={secondaryButton}
              >
                + Add Focus Area
              </button>
            </div>
            {draft.areas.length === 0 ? (
              <p className="text-sm text-muted-foreground">No focus areas yet.</p>
            ) : (
              <div className="overflow-x-auto border border-border rounded-lg">
                <table className="w-full text-sm text-left">
                  <thead className="bg-secondary text-foreground">
                    <tr>
                      <th className="px-2 py-2 font-semibold min-w-36">Name</th>
                      <th className="px-2 py-2 font-semibold min-w-20">Start</th>
                      <th className="px-2 py-2 font-semibold min-w-20">End</th>
                      <th className="px-2 py-2 font-semibold min-w-24">Brake Point (ft)</th>
                      <th className="px-2 py-2 font-semibold min-w-24">Max Brake (%)</th>
                      <th className="px-2 py-2 font-semibold min-w-24">On Throttle (ft)</th>
                      <th className="px-2 py-2 font-semibold min-w-40">Notes</th>
                      <th className="px-2 py-2">
                        <span className="sr-only">Delete</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {draft.areas.map((a, i) => (
                      <tr key={a.uid}>
                        <td className="px-2 py-2">
                          <input
                            aria-label={`Focus area ${i + 1} name`}
                            value={a.name}
                            onChange={(e) => updateArea(a.uid, { name: e.target.value })}
                            placeholder="e.g. T 1"
                            className={cellInputClass}
                          />
                        </td>
                        {(
                          [
                            ['startPoint', 'start', '0.07', 'decimal'],
                            ['endPoint', 'end', '0.14', 'decimal'],
                            ['brakePointFeet', 'brake point', '', 'numeric'],
                            ['maxBrakePct', 'max brake pressure', '', 'numeric'],
                            ['throttlePointFeet', 'on-throttle point', '', 'numeric'],
                          ] as const
                        ).map(([field, label, placeholder, mode]) => (
                          <td key={field} className="px-2 py-2">
                            <input
                              aria-label={`Focus area ${i + 1} ${label}`}
                              inputMode={mode}
                              value={a[field]}
                              onChange={(e) => updateArea(a.uid, { [field]: e.target.value })}
                              placeholder={placeholder}
                              className={`${cellInputClass} text-right tabular-nums`}
                            />
                          </td>
                        ))}
                        <td className="px-2 py-2">
                          <input
                            aria-label={`Focus area ${i + 1} notes`}
                            value={a.notes}
                            onChange={(e) => updateArea(a.uid, { notes: e.target.value })}
                            className={cellInputClass}
                          />
                        </td>
                        <td className="px-2 py-2 text-right">
                          <button
                            type="button"
                            onClick={() => removeArea(a.uid)}
                            className="px-3 py-1 text-sm bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              Start and end are fractions of a lap from the start/finish line (0.07 = 7%). Brake and on-throttle
              points are feet from the start/finish line. Leave a target blank if you don&apos;t have one. Areas are
              put in order around the lap when you save.
            </p>
          </div>

          <div className="flex gap-3">
            <button type="button" onClick={() => void saveTrack()} disabled={saving || !draft.name.trim()} className={primaryButton}>
              {saving ? 'Saving…' : 'Save Track'}
            </button>
            <button type="button" onClick={() => setDraft(null)} disabled={saving} className={secondaryButton}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => startEditing(null)} className={primaryButton}>
          + Add Track
        </button>
      )}

      {/* Track list */}
      {!loaded ? (
        <p className="text-sm text-muted-foreground">Loading your tracks…</p>
      ) : tracks.length === 0 ? (
        <p className="text-sm text-muted-foreground">No tracks added yet.</p>
      ) : (
        <div className="overflow-x-auto bg-card border border-border rounded-lg">
          <table className="w-full text-sm text-left">
            <thead className="bg-secondary text-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Track
                </th>
                <th scope="col" className="px-4 py-3 font-semibold text-right">
                  Length (ft)
                </th>
                <th scope="col" className="px-4 py-3 font-semibold text-right">
                  Focus Areas
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Notes
                </th>
                <th scope="col" className="px-4 py-3">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border text-foreground">
              {tracks.map((track) => (
                <Fragment key={track.id}>
                  <tr className={draft?.id === track.id ? 'bg-accent' : undefined}>
                    <th scope="row" className="px-4 py-3 font-semibold text-foreground">
                      <button
                        type="button"
                        onClick={() => setExpanded(expanded === track.id ? null : track.id)}
                        aria-expanded={expanded === track.id}
                        className="text-left hover:text-primary"
                      >
                        <span className="inline-block w-4 text-muted-foreground">{expanded === track.id ? '▾' : '▸'}</span>
                        {track.name}
                      </button>
                      {track.key !== track.name && <p className="ml-4 text-xs font-normal text-muted-foreground">{track.key}</p>}
                    </th>
                    <td className="px-4 py-3 text-right tabular-nums">{target(track.lengthFeet, '')}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {track.areas.length} / {MAX_FOCUS_AREAS}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{track.notes ?? ''}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => startEditing(track)}
                          className="px-3 py-1 text-sm bg-card border border-border rounded text-foreground hover:border-primary hover:text-primary transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => void removeTrack(track)}
                          className="px-3 py-1 text-sm bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>

                  {/* Focus areas for this track */}
                  {expanded === track.id && (
                    <tr>
                      <td colSpan={5} className="px-4 pb-4 bg-secondary">
                        {track.areas.length === 0 ? (
                          <p className="pt-3 text-sm text-muted-foreground">No focus areas yet. Press Edit to add some.</p>
                        ) : (
                          <table className="mt-3 w-full text-xs text-left bg-card border border-border rounded">
                            <thead className="bg-secondary text-muted-foreground">
                              <tr>
                                <th className="px-3 py-2 font-medium">#</th>
                                <th className="px-3 py-2 font-medium">Name</th>
                                <th className="px-3 py-2 font-medium text-right">Start – End</th>
                                <th className="px-3 py-2 font-medium text-right">Brake Point</th>
                                <th className="px-3 py-2 font-medium text-right">Max Brake</th>
                                <th className="px-3 py-2 font-medium text-right">On Throttle</th>
                                <th className="px-3 py-2 font-medium">Notes</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border" style={{ fontVariantNumeric: 'tabular-nums' }}>
                              {track.areas.map((a) => (
                                <tr key={a.id}>
                                  <td className="px-3 py-1.5 text-muted-foreground">{a.position}</td>
                                  <td className="px-3 py-1.5 font-semibold text-foreground">{a.name}</td>
                                  <td className="px-3 py-1.5 text-right">
                                    {a.startPoint} – {a.endPoint}
                                  </td>
                                  <td className="px-3 py-1.5 text-right">{target(a.brakePointFeet, ' ft')}</td>
                                  <td className="px-3 py-1.5 text-right">{target(a.maxBrakePct, '%')}</td>
                                  <td className="px-3 py-1.5 text-right">{target(a.throttlePointFeet, ' ft')}</td>
                                  <td className="px-3 py-1.5 text-muted-foreground">{a.notes ?? ''}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
