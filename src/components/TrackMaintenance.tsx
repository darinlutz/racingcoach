'use client';

import { Fragment, useMemo, useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import { useUnits } from '@/components/UnitsProvider';
import type { MaintenanceFocusArea, MaintenanceTrack } from '@/lib/trackMaintenance';
import { distanceFromFeet, DISTANCE_UNIT, feetFromDistance } from '@/lib/units';

// The Admin page's Track and Focus Area Maintenance section: every track in racingcoach."Tracks" with its
// key, name and number of corners, adding tracks (POST /api/admin/tracks), and each track's focus areas, which
// can be added, edited and deleted (/api/admin/tracks/[id]/focus-areas). Brake and throttle points are stored
// in feet and shown and typed in the user's Preferred Units.

const inputClass =
  'w-full px-3 py-2 bg-card border border-border rounded-lg text-foreground text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors';
const labelClass = 'block text-xs font-medium text-muted-foreground mb-1';
const primaryButton =
  'px-4 py-2 rounded-lg text-sm font-semibold text-white bg-primary hover:bg-primary-strong transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
const secondaryButton =
  'px-3 py-1.5 rounded-lg text-sm font-medium border border-border text-foreground hover:border-primary transition-colors disabled:opacity-50';

type Message = { ok: boolean; text: string } | null;

// The focus area form's fields, as typed
type AreaForm = {
  name: string;
  startPoint: string;
  endPoint: string;
  brakePoint: string;
  maxBrakePct: string;
  throttlePoint: string;
  notes: string;
};

const emptyAreaForm: AreaForm = { name: '', startPoint: '', endPoint: '', brakePoint: '', maxBrakePct: '', throttlePoint: '', notes: '' };

export default function TrackMaintenance({ tracks: initialTracks }: { tracks: MaintenanceTrack[] }) {
  const { t, fmt } = useLanguage();
  const a = t.admin;
  const units = useUnits();
  const unit = DISTANCE_UNIT[units];
  const [tracks, setTracks] = useState(initialTracks);
  const [search, setSearch] = useState('');
  const [onlyWithAreas, setOnlyWithAreas] = useState(true);
  const [openTrackId, setOpenTrackId] = useState<number | null>(null);
  const [message, setMessage] = useState<Message>(null);

  // Add Track
  const [newKey, setNewKey] = useState('');
  const [newName, setNewName] = useState('');
  const [newCorners, setNewCorners] = useState('');
  const [addingTrack, setAddingTrack] = useState(false);

  // The focus area being added (areaId null) or edited
  const [editing, setEditing] = useState<{ trackId: number; areaId: number | null } | null>(null);
  const [form, setForm] = useState<AreaForm>(emptyAreaForm);
  const [busy, setBusy] = useState(false);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return tracks.filter(
      (track) =>
        (!onlyWithAreas || track.areas.length > 0 || track.id === openTrackId) &&
        (!needle || track.name.toLowerCase().includes(needle) || track.key.toLowerCase().includes(needle))
    );
  }, [tracks, search, onlyWithAreas, openTrackId]);

  const showDistance = (feet: number | null) => (feet === null ? '—' : `${Math.round(distanceFromFeet(feet, units))} ${unit}`);
  const typedDistance = (feet: number | null) => (feet === null ? '' : String(Math.round(distanceFromFeet(feet, units))));

  const send = async (url: string, method: string, body?: unknown) => {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? t.api.failedSaveFocusArea);
    return data;
  };

  const addTrack = async () => {
    setAddingTrack(true);
    setMessage(null);
    try {
      const { track } = (await send('/api/admin/tracks', 'POST', {
        key: newKey,
        name: newName,
        numberOfCorners: newCorners.trim() === '' ? null : Number(newCorners),
      })) as { track: MaintenanceTrack };
      setTracks((list) => [...list, track].sort((x, y) => x.name.toLowerCase().localeCompare(y.name.toLowerCase())));
      setNewKey('');
      setNewName('');
      setNewCorners('');
      setOpenTrackId(track.id);
      setSearch(track.name);
      setMessage({ ok: true, text: fmt(a.trackAdded, { track: track.name }) });
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : t.api.failedSaveTrack });
    } finally {
      setAddingTrack(false);
    }
  };

  const startAdd = (trackId: number) => {
    setEditing({ trackId, areaId: null });
    setForm(emptyAreaForm);
    setMessage(null);
  };

  const startEdit = (trackId: number, area: MaintenanceFocusArea) => {
    setEditing({ trackId, areaId: area.id });
    setForm({
      name: area.name,
      startPoint: String(area.startPoint),
      endPoint: String(area.endPoint),
      brakePoint: typedDistance(area.brakePointFeet),
      maxBrakePct: area.maxBrakePct === null ? '' : String(area.maxBrakePct),
      throttlePoint: typedDistance(area.throttlePointFeet),
      notes: area.notes ?? '',
    });
    setMessage(null);
  };

  const replaceAreas = (trackId: number, areas: MaintenanceFocusArea[]) =>
    setTracks((list) => list.map((track) => (track.id === trackId ? { ...track, areas } : track)));

  const saveArea = async () => {
    if (!editing) return;
    const feet = (value: string) => (value.trim() === '' ? null : Math.round(feetFromDistance(Number(value), units)));
    const body = {
      name: form.name,
      startPoint: Number(form.startPoint),
      endPoint: Number(form.endPoint),
      brakePointFeet: feet(form.brakePoint),
      maxBrakePct: form.maxBrakePct.trim() === '' ? null : Number(form.maxBrakePct),
      throttlePointFeet: feet(form.throttlePoint),
      notes: form.notes,
    };
    setBusy(true);
    setMessage(null);
    try {
      const base = `/api/admin/tracks/${editing.trackId}/focus-areas`;
      const { areas } = (await (editing.areaId === null ? send(base, 'POST', body) : send(`${base}/${editing.areaId}`, 'PUT', body))) as {
        areas: MaintenanceFocusArea[];
      };
      replaceAreas(editing.trackId, areas);
      setMessage({ ok: true, text: fmt(a.areaSaved, { area: body.name.trim() }) });
      setEditing(null);
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : t.api.failedSaveFocusArea });
    } finally {
      setBusy(false);
    }
  };

  const deleteArea = async (trackId: number, area: MaintenanceFocusArea) => {
    if (!window.confirm(fmt(a.confirmDeleteArea, { area: area.name }))) return;
    setBusy(true);
    setMessage(null);
    try {
      const { areas } = (await send(`/api/admin/tracks/${trackId}/focus-areas/${area.id}`, 'DELETE')) as { areas: MaintenanceFocusArea[] };
      replaceAreas(trackId, areas);
      if (editing?.areaId === area.id) setEditing(null);
      setMessage({ ok: true, text: fmt(a.areaDeleted, { area: area.name }) });
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : t.api.failedSaveFocusArea });
    } finally {
      setBusy(false);
    }
  };

  const field = (key: keyof AreaForm, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div>
      <label htmlFor={`area-${key}`} className={labelClass}>
        {label}
      </label>
      <input
        id={`area-${key}`}
        value={form[key]}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        className={inputClass}
        {...props}
      />
    </div>
  );

  const areaForm = (
    <div className="bg-card border border-border rounded-lg p-4 space-y-3">
      <p className="text-sm font-medium text-foreground">{editing?.areaId === null ? a.addArea : a.editArea}</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {field('name', a.areaName, { maxLength: 100 })}
        {field('startPoint', a.areaStart, { type: 'number', step: '0.001', min: 0, max: 1 })}
        {field('endPoint', a.areaEnd, { type: 'number', step: '0.001', min: 0, max: 1 })}
        {field('brakePoint', fmt(a.areaBrakePoint, { unit }), { type: 'number', step: '1', min: 0 })}
        {field('maxBrakePct', a.areaMaxBrake, { type: 'number', step: '1', min: 0, max: 100 })}
        {field('throttlePoint', fmt(a.areaThrottlePoint, { unit }), { type: 'number', step: '1', min: 0 })}
        <div className="sm:col-span-2">{field('notes', a.areaNotes, { maxLength: 2000 })}</div>
      </div>
      <p className="text-xs text-muted-foreground">{a.areaPointsHint}</p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={saveArea}
          disabled={busy || !form.name.trim() || form.startPoint === '' || form.endPoint === ''}
          className={primaryButton}
        >
          {busy ? a.savingArea : a.saveArea}
        </button>
        <button type="button" onClick={() => setEditing(null)} disabled={busy} className={secondaryButton}>
          {t.common.cancel}
        </button>
      </div>
    </div>
  );

  return (
    <div className="bg-secondary rounded-xl border border-border p-4 sm:p-6 space-y-5">
      <div>
        <h2 className="text-xl font-bold text-foreground mb-1">{a.tracksTitle}</h2>
        <p className="text-sm text-muted-foreground">{a.tracksIntro}</p>
      </div>

      {/* Add Track */}
      <div className="bg-card border border-border rounded-lg p-4">
        <p className="text-sm font-medium text-foreground mb-3">{a.addTrack}</p>
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_10rem_auto] items-end">
          <div>
            <label htmlFor="new-track-key" className={labelClass}>{a.trackKey}</label>
            <input id="new-track-key" value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder={a.trackKeyPlaceholder} className={inputClass} />
          </div>
          <div>
            <label htmlFor="new-track-name" className={labelClass}>{a.trackName}</label>
            <input id="new-track-name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={a.trackNamePlaceholder} className={inputClass} />
          </div>
          <div>
            <label htmlFor="new-track-corners" className={labelClass}>{a.trackCorners}</label>
            <input
              id="new-track-corners"
              type="number"
              min={1}
              step={1}
              value={newCorners}
              onChange={(e) => setNewCorners(e.target.value)}
              className={inputClass}
            />
          </div>
          <button type="button" onClick={addTrack} disabled={addingTrack || !newKey.trim() || !newName.trim()} className={primaryButton}>
            {addingTrack ? a.addingTrack : a.addTrackButton}
          </button>
        </div>
      </div>

      {/* Find tracks */}
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex-1 min-w-[14rem]">
          <label htmlFor="track-search" className={labelClass}>{a.searchTracks}</label>
          <input
            id="track-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={a.searchTracksPlaceholder}
            autoComplete="off"
            className={inputClass}
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-foreground pb-2">
          <input type="checkbox" checked={onlyWithAreas} onChange={(e) => setOnlyWithAreas(e.target.checked)} className="accent-primary" />
          {a.onlyWithAreas}
        </label>
        <span className="text-xs text-muted-foreground pb-2">{fmt(a.tracksShown, { shown: visible.length, total: tracks.length })}</span>
      </div>

      {message && (
        <p
          role="status"
          className={`p-3 rounded-lg text-sm ${message.ok ? 'bg-green-500/15 text-green-400' : 'bg-primary/15 border border-primary/40 text-red-300'}`}
        >
          {message.text}
        </p>
      )}

      {/* Tracks, each opening to its focus areas */}
      <div className="bg-card rounded-lg border border-border overflow-hidden">
        <div className="overflow-x-auto max-h-[48rem] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-card text-left text-xs text-muted-foreground sticky top-0">
              <tr>
                {[a.trackKey, a.trackName, a.trackCorners, a.focusAreas, ''].map((heading, i) => (
                  <th key={i} className="px-3 py-2 font-medium whitespace-nowrap">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visible.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">{a.noTracks}</td>
                </tr>
              )}
              {visible.map((track) => {
                const open = track.id === openTrackId;
                return (
                  <Fragment key={track.id}>
                    <tr className={open ? 'bg-primary/10' : 'hover:bg-secondary'}>
                      <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{track.key}</td>
                      <td className="px-3 py-2 text-foreground">{track.name}</td>
                      <td className="px-3 py-2 tabular-nums">{track.numberOfCorners ?? '—'}</td>
                      <td className="px-3 py-2 tabular-nums">{track.areas.length}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => {
                            setOpenTrackId(open ? null : track.id);
                            setEditing(null);
                          }}
                          className={secondaryButton}
                        >
                          {open ? a.hideAreas : a.showAreas}
                        </button>
                      </td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={5} className="px-3 py-4 bg-secondary space-y-3">
                          {track.areas.length === 0 ? (
                            <p className="text-sm text-muted-foreground">{a.noAreas}</p>
                          ) : (
                            <div className="overflow-x-auto">
                              <table className="w-full text-sm">
                                <thead className="text-left text-xs text-muted-foreground">
                                  <tr>
                                    {[
                                      '#',
                                      a.areaName,
                                      a.areaStart,
                                      a.areaEnd,
                                      fmt(a.areaBrakePoint, { unit }),
                                      a.areaMaxBrake,
                                      fmt(a.areaThrottlePoint, { unit }),
                                      a.areaNotes,
                                      '',
                                    ].map((heading, i) => (
                                      <th key={i} className="px-2 py-1 font-medium whitespace-nowrap">{heading}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-border">
                                  {track.areas.map((area) => (
                                    <tr key={area.id} className={editing?.areaId === area.id ? 'bg-primary/10' : undefined}>
                                      <td className="px-2 py-1.5 tabular-nums">{area.position}</td>
                                      <td className="px-2 py-1.5 text-foreground">{area.name}</td>
                                      <td className="px-2 py-1.5 tabular-nums">{area.startPoint}</td>
                                      <td className="px-2 py-1.5 tabular-nums">{area.endPoint}</td>
                                      <td className="px-2 py-1.5 tabular-nums whitespace-nowrap">{showDistance(area.brakePointFeet)}</td>
                                      <td className="px-2 py-1.5 tabular-nums">{area.maxBrakePct === null ? '—' : `${area.maxBrakePct}%`}</td>
                                      <td className="px-2 py-1.5 tabular-nums whitespace-nowrap">{showDistance(area.throttlePointFeet)}</td>
                                      <td className="px-2 py-1.5 max-w-[16rem] truncate text-muted-foreground" title={area.notes ?? undefined}>
                                        {area.notes ?? ''}
                                      </td>
                                      <td className="px-2 py-1.5 text-right whitespace-nowrap space-x-2">
                                        <button type="button" onClick={() => startEdit(track.id, area)} disabled={busy} className={secondaryButton}>
                                          {t.common.edit}
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => deleteArea(track.id, area)}
                                          disabled={busy}
                                          className={`${secondaryButton} hover:border-red-400 hover:text-red-400`}
                                        >
                                          {t.common.delete}
                                        </button>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                          {editing?.trackId === track.id ? (
                            areaForm
                          ) : (
                            <button type="button" onClick={() => startAdd(track.id)} disabled={busy} className={primaryButton}>
                              {a.addArea}
                            </button>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
