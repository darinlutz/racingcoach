'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import LiveTrackMap, { type MapCar } from '@/components/LiveTrackMap';
import { useUnits } from '@/components/UnitsProvider';
import type { LiveDriver } from '@/lib/liveRacing';
import type { TrackOutline } from '@/lib/trackOutlines';
import { METERS_PER_FOOT, SPEED_UNIT, speedFromMetersPerSecond } from '@/lib/units';

// The Live Racing page's tracks: each track someone the user may watch is driving, as a map with a dot per car, and
// beside it each of those drivers' lap details. Asks GET /api/live every second while the page is showing, and each
// track's map from GET /api/live/outline (again every minute while it's missing or approximate, as an exact one
// appears once a lap with track positions uploads).

const POLL_MS = 1000;
const OUTLINE_RETRY_MS = 60_000;
// The user's own dot, then the others' in turn
const ME_COLOR = '#DE3341';
const COLORS = ['#3B8BFF', '#2EB872', '#E3A82B', '#A855F7', '#14B8A6', '#F97316', '#EC4899', '#84CC16'];

type LiveTrack = {
  name: string | null;
  lengthFeet: number | null;
  outline: TrackOutline | null;
  areas: { name: string; start: number; end: number }[];
  approximate: boolean;
};

// A driver as received, with when (performance.now()) their collector's update was sampled
type Received = LiveDriver & { sampledAt: number };

const groupKey = (d: LiveDriver) => (d.trackKey ? d.trackKey.toLowerCase() : `name:${d.track}`);

// 109.479 -> "1:49.479"; iRacing gives 0 or -1 when there's no time
function lapTime(seconds: number | null | undefined): string {
  if (seconds == null || seconds <= 0) return '—';
  const ms = Math.round(seconds * 1000);
  const minutes = Math.floor(ms / 60_000);
  const rest = (ms % 60_000) / 1000;
  return `${minutes}:${rest.toFixed(3).padStart(6, '0')}`;
}

export default function LiveRacing() {
  const { t, fmt } = useLanguage();
  const units = useUnits();
  const [drivers, setDrivers] = useState<Received[] | null>(null);
  const [error, setError] = useState('');
  const [tracks, setTracks] = useState<Record<string, LiveTrack | null>>({});
  // When each track's map was last asked for, and whether it was asked with a driver's approximate outline
  const asked = useRef(new Map<string, { at: number; withApproximate: boolean }>());

  useEffect(() => {
    let stopped = false;
    let timer = 0;
    const poll = async () => {
      if (document.visibilityState === 'visible') {
        try {
          const response = await fetch('/api/live', { cache: 'no-store' });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || t.api.failedLoadLiveRacing);
          const now = performance.now();
          if (!stopped) {
            setDrivers((data.drivers as LiveDriver[]).map((d) => ({ ...d, sampledAt: now - d.ageMs })));
            setError('');
          }
        } catch (err) {
          if (!stopped) setError(err instanceof Error ? err.message : t.common.unknownError);
        }
      }
      if (!stopped) timer = window.setTimeout(poll, POLL_MS);
    };
    poll();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [t]);

  const groups = useMemo(() => {
    const byTrack = new Map<string, Received[]>();
    for (const d of drivers ?? []) {
      const key = groupKey(d);
      byTrack.set(key, [...(byTrack.get(key) ?? []), d]);
    }
    // The user's own track first
    return [...byTrack.entries()].sort(([, a], [, b]) => Number(b.some((d) => d.isMe)) - Number(a.some((d) => d.isMe)));
  }, [drivers]);

  // Each car keeps its color while it's listed
  const colors = useMemo(() => {
    const map = new Map<number, string>();
    let next = 0;
    for (const d of [...(drivers ?? [])].sort((a, b) => a.userId - b.userId)) {
      map.set(d.userId, d.isMe ? ME_COLOR : COLORS[next++ % COLORS.length]);
    }
    return map;
  }, [drivers]);

  // Ask for the maps of tracks that don't have one yet
  useEffect(() => {
    const now = Date.now();
    for (const [key, group] of groups) {
      const trackKey = group.find((d) => d.trackKey)?.trackKey;
      if (!trackKey) continue;
      const known = tracks[key];
      const withDriver = group.find((d) => d.hasApproximateOutline);
      const previous = asked.current.get(key);
      const exact = known?.outline && !known.approximate;
      if (exact) continue;
      const due = !previous || now - previous.at > OUTLINE_RETRY_MS || (!!withDriver && !previous.withApproximate);
      if (!due) continue;
      asked.current.set(key, { at: now, withApproximate: !!withDriver });
      const params = new URLSearchParams({ key: trackKey });
      if (withDriver) params.set('driver', String(withDriver.userId));
      fetch(`/api/live/outline?${params}`)
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => {
          if (data) setTracks((current) => ({ ...current, [key]: data.track }));
        })
        .catch(() => {
          // asked again in a minute
        });
    }
  }, [groups, tracks]);

  if (drivers === null) {
    return error ? <p className="text-sm text-red-300">{error}</p> : <p className="text-muted-foreground">{t.common.loading}</p>;
  }

  if (groups.length === 0) {
    return (
      <div className="bg-card rounded-lg border border-border px-6 py-10 text-center">
        <p className="text-foreground font-medium">{t.liveRacing.nobodyLive}</p>
        <p className="mt-2 text-sm text-muted-foreground">{t.liveRacing.nobodyLiveHint}</p>
        {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
      </div>
    );
  }

  const status = (d: LiveDriver) =>
    d.offline ? t.liveRacing.offline : !d.onTrack ? t.liveRacing.inGarage : d.onPitRoad ? t.liveRacing.pitRoad : t.liveRacing.onTrack;

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-red-300">{error}</p>}
      {groups.map(([key, group]) => {
        const track = tracks[key];
        const cars: MapCar[] = group.map((d) => ({
          id: d.userId,
          label: d.isMe ? t.liveRacing.you : d.driver,
          color: colors.get(d.userId) ?? COLORS[0],
          pct: d.onTrack && !d.offline && d.pct != null ? d.pct : null,
          speed: d.speed ?? 0,
          sampledAt: d.sampledAt,
          moving: d.onTrack && !d.offline,
          highlight: d.isMe,
        }));
        return (
          <div key={key} className="bg-card rounded-lg border border-border overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <h2 className="text-lg font-semibold text-foreground">{track?.name ?? group[0].track}</h2>
            </div>
            <div className="grid lg:grid-cols-3">
              <div className="lg:col-span-2 p-4">
                <div className="aspect-[4/3] w-full">
                  <LiveTrackMap
                    outline={track?.outline ?? null}
                    areas={track?.areas ?? []}
                    cars={cars}
                    startFinishLabel={t.liveRacing.startFinish}
                    lengthMeters={track?.lengthFeet ? track.lengthFeet * METERS_PER_FOOT : null}
                  />
                </div>
                {(!track?.outline || track.approximate) && (
                  <p className="mt-2 text-xs text-muted-foreground">{track?.outline ? t.liveRacing.approximateMap : t.liveRacing.noMap}</p>
                )}
              </div>
              <ul className="border-t lg:border-t-0 lg:border-l border-border divide-y divide-border">
                {group.map((d) => (
                  <li key={d.userId} className={`px-4 py-3 ${d.offline ? 'opacity-60' : ''}`}>
                    <div className="flex items-center gap-2">
                      <span className="size-3 rounded-full shrink-0" style={{ backgroundColor: colors.get(d.userId) }} />
                      <span className="font-semibold text-foreground truncate">{d.driver}</span>
                      {d.isMe && <span className="text-xs text-primary font-semibold">{t.liveRacing.you}</span>}
                      <span className="ml-auto text-xs text-muted-foreground">{status(d)}</span>
                    </div>
                    <p className="mt-0.5 text-sm text-muted-foreground truncate">
                      {[d.car, d.sessionType, d.lap != null && d.lap > 0 ? fmt(t.liveRacing.lap, { n: d.lap }) : null,
                        d.position ? fmt(t.liveRacing.position, { n: d.position }) : null].filter(Boolean).join(' · ')}
                    </p>
                    <dl className="mt-2 grid grid-cols-3 gap-x-3 gap-y-1 text-sm">
                      <div>
                        <dt className="text-xs text-muted-foreground">{t.liveRacing.speed}</dt>
                        <dd className="font-semibold text-foreground tabular-nums">
                          {d.speed != null && d.onTrack ? `${Math.round(speedFromMetersPerSecond(d.speed, units))} ${SPEED_UNIT[units]}` : '—'}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">{t.liveRacing.gear}</dt>
                        <dd className="font-semibold text-foreground">
                          {d.gear == null || !d.onTrack ? '—' : d.gear === -1 ? 'R' : d.gear === 0 ? 'N' : d.gear}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">{t.liveRacing.vsBest}</dt>
                        <dd
                          className={`font-semibold tabular-nums ${
                            d.deltaToBest == null || !d.bestLapTime || d.bestLapTime <= 0
                              ? 'text-foreground'
                              : d.deltaToBest > 0
                                ? 'text-red-400'
                                : 'text-green-500'
                          }`}
                        >
                          {d.deltaToBest == null || !d.bestLapTime || d.bestLapTime <= 0
                            ? '—'
                            : `${d.deltaToBest > 0 ? '+' : d.deltaToBest < 0 ? '−' : ''}${Math.abs(d.deltaToBest).toFixed(3)}`}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">{t.liveRacing.current}</dt>
                        <dd className="font-mono text-foreground">{lapTime(d.currentLapTime)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">{t.liveRacing.last}</dt>
                        <dd className="font-mono text-foreground">{lapTime(d.lastLapTime)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">{t.liveRacing.best}</dt>
                        <dd className="font-mono text-foreground">{lapTime(d.bestLapTime)}</dd>
                      </div>
                    </dl>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        );
      })}
    </div>
  );
}
