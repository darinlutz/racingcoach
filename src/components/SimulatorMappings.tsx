'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import type { SimulatorMappingList, SimulatorMappingRow } from '@/lib/simulatorMappings';
import { acceptsLapsFrom, findSimulator } from '@/lib/simulators';

// The Coach page's Simulator Mapping: links another simulator's tracks and cars (its catalog, simulatorCatalogs.ts,
// and any seen in laps) to the site's Track Data tracks and Car Data cars, through /api/coach/simulator-mappings.
// A mapped lap takes the site's names and track key (simulatorMappings.ts), so it compares with iRacing's laps.

const inputClass =
  'w-full px-3 py-2 bg-card border border-border rounded-lg text-foreground text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors';
const labelClass = 'block text-xs font-medium text-muted-foreground mb-1';

type Kind = 'track' | 'car';
type Message = { ok: boolean; text: string } | null;

export default function SimulatorMappings({ simulators }: { simulators: string[] }) {
  const { t, fmt } = useLanguage();
  const m = t.coach.simulatorMapping;
  const [simulator, setSimulator] = useState(simulators[0] ?? '');
  const [kind, setKind] = useState<Kind>('track');
  const [list, setList] = useState<SimulatorMappingList | null>(null);
  const [search, setSearch] = useState('');
  const [onlyUnmapped, setOnlyUnmapped] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const simulatorName = findSimulator(simulator)?.displayName ?? simulator;

  useEffect(() => {
    if (!simulator) return;
    let cancelled = false;
    fetch(`/api/coach/simulator-mappings?simulator=${encodeURIComponent(simulator)}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? t.api.failedSaveSimulatorMapping);
        if (!cancelled) setList(data as SimulatorMappingList);
      })
      .catch((error) => {
        if (!cancelled) setMessage({ ok: false, text: error instanceof Error ? error.message : t.api.failedSaveSimulatorMapping });
      });
    return () => {
      cancelled = true;
    };
  }, [simulator, t.api.failedSaveSimulatorMapping]);

  const rows = useMemo(() => {
    if (!list) return [];
    const needle = search.trim().toLowerCase();
    return (kind === 'track' ? list.tracks : list.cars).filter(
      (row) =>
        (!onlyUnmapped || row.siteId === null) &&
        (!needle || row.nativeName.toLowerCase().includes(needle) || row.nativeKey.toLowerCase().includes(needle))
    );
  }, [list, kind, search, onlyUnmapped]);

  const siteName = (id: number | null) =>
    id === null ? null : (kind === 'track' ? list?.siteTracks : list?.siteCars)?.find((site) => site.id === id)?.name ?? null;

  const save = async (row: SimulatorMappingRow, siteId: number | null) => {
    setBusyKey(row.nativeKey);
    setMessage(null);
    try {
      const res = await fetch('/api/coach/simulator-mappings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ simulator, kind, nativeKey: row.nativeKey, siteId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? t.api.failedSaveSimulatorMapping);
      setList(data as SimulatorMappingList);
      const site = siteName(siteId);
      setMessage({ ok: true, text: site ? fmt(m.mapped, { name: row.nativeName, site }) : fmt(m.unmapped, { name: row.nativeName }) });
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : t.api.failedSaveSimulatorMapping });
    } finally {
      setBusyKey(null);
    }
  };

  const options = () => {
    if (!list) return null;
    if (kind === 'car') {
      return list.siteCars.map((car) => (
        <option key={car.id} value={car.id}>
          {car.name}
        </option>
      ));
    }
    const group = (label: string, withAreas: boolean) => (
      <optgroup label={label}>
        {list.siteTracks
          .filter((track) => track.hasFocusAreas === withAreas)
          .map((track) => (
            <option key={track.id} value={track.id}>
              {track.name}
            </option>
          ))}
      </optgroup>
    );
    return (
      <>
        {group(m.withFocusAreas, true)}
        {group(m.otherTracks, false)}
      </>
    );
  };

  return (
    <div className="bg-secondary rounded-xl border border-border p-4 sm:p-6 space-y-5">
      <div>
        <h2 className="text-xl font-bold text-foreground mb-1">{m.title}</h2>
        <p className="text-sm text-muted-foreground">{m.intro}</p>
        {simulator && !acceptsLapsFrom(simulator) && (
          <p className="text-sm text-muted-foreground mt-2">{fmt(m.notAcceptedYet, { simulator: simulatorName })}</p>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-[14rem_auto_1fr_auto] items-end">
        <div>
          <label htmlFor="mapping-simulator" className={labelClass}>{m.simulator}</label>
          <select
            id="mapping-simulator"
            value={simulator}
            onChange={(e) => {
              setSimulator(e.target.value);
              setList(null);
            }}
            className={inputClass}
          >
            {simulators.map((id) => (
              <option key={id} value={id}>
                {findSimulator(id)?.displayName ?? id}
              </option>
            ))}
          </select>
        </div>
        <div className="flex gap-2" role="tablist">
          {(['track', 'car'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={kind === value}
              onClick={() => setKind(value)}
              data-track={`simulator-mapping-${value}s`}
              className={`px-4 py-2 rounded-lg text-sm font-semibold border transition-colors ${
                kind === value ? 'bg-primary text-white border-primary' : 'border-border text-foreground hover:border-primary'
              }`}
            >
              {value === 'track' ? m.tracks : m.cars}
            </button>
          ))}
        </div>
        <div>
          <label htmlFor="mapping-search" className={labelClass}>{m.search}</label>
          <input id="mapping-search" value={search} onChange={(e) => setSearch(e.target.value)} className={inputClass} />
        </div>
        <label className="inline-flex items-center gap-2 cursor-pointer text-sm text-foreground pb-2">
          <input type="checkbox" checked={onlyUnmapped} onChange={(e) => setOnlyUnmapped(e.target.checked)} className="h-4 w-4 accent-primary" />
          {m.onlyUnmapped}
        </label>
      </div>

      {message && (
        <p role="status" className={`text-sm ${message.ok ? 'text-green-600' : 'text-red-600'}`}>
          {message.text}
        </p>
      )}

      <div className="bg-card rounded-lg border border-border overflow-hidden">
        <div className="overflow-x-auto max-h-[40rem] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-card text-left text-xs text-muted-foreground sticky top-0">
              <tr>
                {[fmt(m.nativeColumn, { simulator: simulatorName }), kind === 'track' ? m.siteTrackColumn : m.siteCarColumn, m.lapsColumn].map(
                  (heading) => (
                    <th key={heading} className="px-3 py-2 font-medium whitespace-nowrap">{heading}</th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {!list ? (
                <tr>
                  <td colSpan={3} className="px-3 py-8 text-center text-muted-foreground">{t.common.loading}</td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-3 py-8 text-center text-muted-foreground">{m.none}</td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.nativeKey} className="border-t border-border">
                    <td className="px-3 py-2 align-middle">
                      <div className="text-foreground">{row.nativeName}</div>
                      <div className="font-mono text-xs text-muted-foreground">{row.nativeKey}</div>
                    </td>
                    <td className="px-3 py-2 align-middle min-w-[16rem]">
                      <select
                        aria-label={row.nativeName}
                        value={row.siteId ?? ''}
                        disabled={busyKey !== null}
                        onChange={(e) => save(row, e.target.value === '' ? null : Number(e.target.value))}
                        data-track={`simulator-mapping-${kind}`}
                        className={inputClass}
                      >
                        <option value="">{m.notMapped}</option>
                        {options()}
                      </select>
                    </td>
                    <td className="px-3 py-2 align-middle tabular-nums text-muted-foreground">{row.laps}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
