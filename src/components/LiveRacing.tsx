'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import LiveDriverMessage from '@/components/LiveDriverMessage';
import LiveDriverRadio from '@/components/LiveDriverRadio';
import LiveInputs, { type TimedSample } from '@/components/LiveInputs';
import LiveLeaderboard, { type LeaderboardDriver, runningOrder } from '@/components/LiveLeaderboard';
import LiveSessionBanner from '@/components/LiveSessionBanner';
import LiveSessionStatus from '@/components/LiveSessionStatus';
import LiveTrackMap, { type MapCar } from '@/components/LiveTrackMap';
import { useUnits } from '@/components/UnitsProvider';
import type { LiveDriver, LiveField } from '@/lib/liveRacing';
import { formatLapTime as lapTime } from '@/lib/liveRacingFormat';
import { reportRateLimit } from '@/lib/rateLimitClient';
import { useMapSettings } from '@/lib/satelliteImagery';
import { CommentaryQueue } from '@/lib/tvAudio';
import type { TrackOutline } from '@/lib/trackOutlines';
import { METERS_PER_FOOT, SPEED_UNIT, speedFromMetersPerSecond } from '@/lib/units';

// The Live Racing page's tracks: each track someone the user may watch is driving, headed by each session's flag,
// session and weather (LiveSessionBanner), then in three columns. On the left the
// session's lap and time remaining over a leaderboard of every car in it (from collectors that send the field); in
// the middle the map, with a dot per car, and under it each watched driver's lap details; on the right one driver's
// (the user, until they pick another in the list) Driver Inputs and incidents, the Lead and Color Announcer checkboxes (the Race
// Announcers commentate on what happens in that driver's session, POST /api/live/announcer, in the voices picked on
// the Account page; shown while the Admin page's Enable AI Features is on, announcers; both on until turned off, and
// about the user's own driving never over their In-Car AI Coach, see coachQuiet) and Message Driver, which
// their In-Car AI Coach says in their car (POST /api/live/message), and Driver Radio: what that driver said over the
// radio, as text, each new message played in the site's Driver Radio voice (GET /api/live/radio-speech) while Play
// driver radio is on (on until turned off; for the user's own, never over their In-Car AI Coach). Narrower than xl, the columns stack: map, inputs, leaderboard. Asks GET /api/live every second while the page is showing, and each
// track's map from GET /api/live/outline (again every minute while it's missing or approximate, as an exact one
// appears once a lap with track positions uploads).

const POLL_MS = 1000;
const ANNOUNCER_KEYS = { lead: 'liveRacing.leadAnnouncer', color: 'liveRacing.colorAnnouncer' } as const;
const RADIO_KEY = 'liveRacing.playRadio';
// The satellite imagery's opacity under the maps (0-100), kept in the browser
const IMAGERY_KEY = 'liveRacing.satelliteOpacity';
const DEFAULT_IMAGERY_OPACITY = 60;
type Announcer = keyof typeof ANNOUNCER_KEYS;
// A new clock offset this close to the last is noise (network timing), and the samples keep the old one
const OFFSET_TOLERANCE_MS = 400;
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

// A session's field, from the watched driver in it whose update is newest
type SessionField = { key: string; field: LiveField; from: Received; isRace: boolean };

// The sessions the group's drivers are in: one field per subsession (offline sessions, 0, are each driver's own)
function sessionFields(group: Received[]): SessionField[] {
  const bySession = new Map<string, Received>();
  for (const d of group) {
    if (!d.field || d.offline) continue;
    const key = d.field.subSessionId > 0 ? `s:${d.field.subSessionId}` : `u:${d.userId}`;
    const current = bySession.get(key);
    if (!current || d.ageMs < current.ageMs) bySession.set(key, d);
  }
  return [...bySession.entries()].map(([key, from]) => ({
    key,
    field: from.field!,
    from,
    isRace: from.sessionType?.toLowerCase() === 'race',
  }));
}

// Plays a base64 WAV (a Race Announcer's line) at volume (0-1), resolving when it ends or can't play
function playWav(base64: string, volume = 1): Promise<void> {
  return new Promise((resolve) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
    const audio = new Audio(url);
    audio.volume = Math.min(Math.max(volume, 0), 1);
    const done = () => {
      URL.revokeObjectURL(url);
      resolve();
    };
    audio.onended = done;
    audio.onerror = done;
    audio.play().catch(done);
  });
}

// Plays an MP3 (a Driver Radio message), resolving when it ends or can't play
function playMp3(blob: Blob): Promise<void> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    const done = () => {
      URL.revokeObjectURL(url);
      resolve();
    };
    audio.onended = done;
    audio.onerror = done;
    audio.play().catch(done);
  });
}

// How long an MP3 plays, in ms, read from the browser before it's played
function mp3DurationMs(blob: Blob): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio();
    const done = (ms: number) => {
      URL.revokeObjectURL(url);
      resolve(ms);
    };
    audio.onloadedmetadata = () => done(Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : 8000);
    audio.onerror = () => done(8000);
    audio.preload = 'metadata';
    audio.src = url;
  });
}

// How long a base64 WAV plays, in ms, from its header's byte rate (a guess when it has no header)
function wavDurationMs(base64: string): number {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  if (bytes.length <= 44) return 0;
  const byteRate = new DataView(bytes.buffer).getUint32(28, true);
  return byteRate > 0 ? Math.round(((bytes.length - 44) / byteRate) * 1000) : 8000;
}

const delay = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

// Before an announcer line about the user's own driving: how long the collector has to hear of it (its next live
// update, within half a second in the car) before it plays, and a little extra on the hold after it ends
const HOLD_LEAD_MS = 700;
const HOLD_MARGIN_MS = 300;
// How long a line waits for the In-Car AI Coach to finish before it's dropped, the moment having passed
const COACH_WAIT_MS = 15_000;

// Resolves true once the user's In-Car AI Coach isn't speaking (as their collector last said), false after COACH_WAIT_MS
async function coachQuiet(me: { current: Received | null }): Promise<boolean> {
  const until = Date.now() + COACH_WAIT_MS;
  while (me.current?.coachSpeaking && !me.current.offline) {
    if (Date.now() > until) return false;
    await delay(200);
  }
  return true;
}

// The car index of each watched driver in this session
function driversInSession(group: Received[], session: SessionField): Map<number, Received> {
  const cars = new Map<number, Received>();
  for (const d of group) {
    if (d.field?.myCarIdx == null) continue;
    const same = session.field.subSessionId > 0 ? d.field.subSessionId === session.field.subSessionId : d === session.from;
    if (same) cars.set(d.field.myCarIdx, d);
  }
  return cars;
}

export default function LiveRacing({ announcers: showAnnouncers }: { announcers: boolean }) {
  const { t, fmt } = useLanguage();
  const units = useUnits();
  const [drivers, setDrivers] = useState<Received[] | null>(null);
  // The driver whose inputs are shown (null: the user, else the first listed), and their recent inputs
  const [picked, setPicked] = useState<number | null>(null);
  const focusRef = useRef<number | null>(null);
  const [samples, setSamples] = useState<TimedSample[]>([]);
  // Page clock (ms) minus the collector's SessionTime (ms), for the focused driver's samples
  const offset = useRef<{ driver: number; ms: number } | null>(null);
  // The Race Announcers turned on, and the focused driver's newest race event already commentated (or there when the
  // page started watching them); one request at a time, its lines queued (CommentaryQueue: one at a time, a more
  // important commentary replacing less important lines still waiting, lines past their moment dropped) and played
  // while the next is asked for
  const [announcers, setAnnouncers] = useState<Record<Announcer, boolean>>({ lead: true, color: true });
  const [announcerError, setAnnouncerError] = useState('');
  const commentated = useRef<{ driver: number; seq: number } | null>(null);
  const commentating = useRef(false);
  const commentary = useRef(new CommentaryQueue());
  const commentaryPlaying = useRef(false);
  // The user's own live state as last polled, for whether their In-Car AI Coach is speaking
  const meRef = useRef<Received | null>(null);
  // Driver Radio: played while on, the focused driver's newest radio message already played (or there when the page
  // started watching them), one at a time
  const [playRadio, setPlayRadio] = useState(true);
  const [imageryOpacity, setImageryOpacity] = useState(DEFAULT_IMAGERY_OPACITY);
  const mapSettings = useMapSettings();
  const [radioError, setRadioError] = useState('');
  const radioHeard = useRef<{ driver: number; seq: number } | null>(null);
  const radioPlaying = useRef(false);

  useEffect(() => {
    try {
      // The announcers are on unless turned off
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read once from browser storage after hydration
      setAnnouncers({
        lead: window.localStorage.getItem(ANNOUNCER_KEYS.lead) !== '0',
        color: window.localStorage.getItem(ANNOUNCER_KEYS.color) !== '0',
      });
      setPlayRadio(window.localStorage.getItem(RADIO_KEY) !== '0');
      const opacity = Number(window.localStorage.getItem(IMAGERY_KEY) ?? NaN);
      if (Number.isFinite(opacity)) setImageryOpacity(Math.min(Math.max(opacity, 0), 100));
    } catch {
      // storage blocked: announcers and radio on, the imagery at its default
    }
  }, []);
  const changeImageryOpacity = (opacity: number) => {
    setImageryOpacity(opacity);
    try {
      window.localStorage.setItem(IMAGERY_KEY, String(opacity));
    } catch {
      // kept for this visit only
    }
  };
  const togglePlayRadio = (on: boolean) => {
    setPlayRadio(on);
    setRadioError('');
    try {
      window.localStorage.setItem(RADIO_KEY, on ? '1' : '0');
    } catch {
      // kept for this visit only
    }
  };
  const toggleAnnouncer = (announcer: Announcer, on: boolean) => {
    setAnnouncers((current) => ({ ...current, [announcer]: on }));
    setAnnouncerError('');
    try {
      window.localStorage.setItem(ANNOUNCER_KEYS[announcer], on ? '1' : '0');
    } catch {
      // kept for this visit only
    }
  };
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
          const focus = focusRef.current;
          const response = await fetch(focus ? `/api/live?inputs=${focus}` : '/api/live', { cache: 'no-store' });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || t.api.failedLoadLiveRacing);
          const now = performance.now();
          if (!stopped) {
            const received = (data.drivers as LiveDriver[]).map((d) => ({ ...d, sampledAt: now - d.ageMs }));
            setDrivers(received);
            meRef.current = received.find((d) => d.isMe) ?? null;
            setError('');
            const focused = received.find((d) => d.userId === focus);
            const inputs = focused?.inputs;
            if (focused && inputs && inputs.length > 0) {
              const ms = focused.sampledAt - inputs[inputs.length - 1][0] * 1000;
              const kept = offset.current?.driver === focused.userId && Math.abs(offset.current.ms - ms) < OFFSET_TOLERANCE_MS;
              if (!kept) offset.current = { driver: focused.userId, ms };
              const base = offset.current!.ms;
              setSamples(inputs.map((sample) => ({ at: base + sample[0] * 1000, sample })));
            } else if (!focused?.onTrack) {
              setSamples([]);
            }
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

  // The focused driver: the one picked, else the user, else the first listed
  const focus = useMemo(() => {
    const list = drivers ?? [];
    return (list.find((d) => d.userId === picked) ?? list.find((d) => d.isMe) ?? list[0])?.userId ?? null;
  }, [drivers, picked]);
  useEffect(() => {
    focusRef.current = focus;
  }, [focus]);
  const focused = drivers?.find((d) => d.userId === focus) ?? null;

  // Plays the queued announcer lines one after another. Watching themselves, the driver hears their In-Car AI Coach
  // too: each line waits for it to finish (a line it held up too long is dropped), then holds it while it plays
  const playCommentary = useCallback(async () => {
    if (commentaryPlaying.current) return;
    commentaryPlaying.current = true;
    try {
      for (let line = commentary.current.next(Date.now()); line; line = commentary.current.next(Date.now())) {
        if (meRef.current && focusRef.current === meRef.current.userId) {
          if (!(await coachQuiet(meRef))) continue;
          await fetch('/api/live/announcing', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ms: wavDurationMs(line.audio) + HOLD_LEAD_MS + HOLD_MARGIN_MS }),
          }).catch(() => undefined);
          await delay(HOLD_LEAD_MS);
        }
        await playWav(line.audio, line.volume ?? 1);
      }
    } finally {
      commentaryPlaying.current = false;
    }
  }, []);

  // The Race Announcers commentate on the focused driver's race events as they happen
  useEffect(() => {
    if (!focused) return;
    const seen = commentated.current;
    if (!seen || seen.driver !== focused.userId) {
      commentated.current = { driver: focused.userId, seq: focused.eventSeq };
      commentary.current.clear();
      return;
    }
    const on = showAnnouncers && (announcers.lead || announcers.color);
    if (!on || focused.offline) {
      seen.seq = focused.eventSeq;
      if (!on) commentary.current.clear();
      return;
    }
    if (focused.eventSeq <= seen.seq || commentating.current) return;
    commentating.current = true;
    const driver = focused.userId;
    const latest = focused.eventSeq;
    (async () => {
      try {
        const response = await fetch('/api/live/announcer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ driverId: driver, after: seen.seq, lead: announcers.lead, color: announcers.color }),
        });
        const data = await response.json().catch(() => ({}));
        if (commentated.current?.driver === driver) {
          commentated.current.seq = Math.max(commentated.current.seq, latest, data.seq ?? 0);
        }
        if (!response.ok) {
          reportRateLimit(response, data);
          throw new Error(data.error || t.liveRacing.announcerFailed);
        }
        setAnnouncerError('');
        if (commentated.current?.driver !== driver) return;
        const now = Date.now();
        type Line = { speaker: Announcer; text: string; audio: string; priority?: number; ttlMs?: number; volume?: number };
        commentary.current.push(
          ((data.lines ?? []) as Line[]).map((l) => ({ ...l, expiresAt: l.ttlMs != null ? now + l.ttlMs : undefined })),
          now,
          !!data.replaceQueued
        );
        playCommentary();
      } catch (err) {
        setAnnouncerError(err instanceof Error ? err.message : t.liveRacing.announcerFailed);
      } finally {
        commentating.current = false;
      }
    })();
  }, [focused, announcers, showAnnouncers, t, playCommentary]);

  // Driver Radio: each of the focused driver's new radio messages, said in the Driver Radio voice
  useEffect(() => {
    if (!focused) return;
    const heard = radioHeard.current;
    if (!heard || heard.driver !== focused.userId) {
      radioHeard.current = { driver: focused.userId, seq: focused.radioSeq };
      return;
    }
    if (!playRadio || focused.offline) {
      heard.seq = focused.radioSeq;
      return;
    }
    if (focused.radioSeq <= heard.seq || radioPlaying.current) return;
    radioPlaying.current = true;
    const driver = focused.userId;
    const mine = focused.isMe;
    const waiting = focused.radio.filter((r) => r.seq > heard.seq);
    heard.seq = focused.radioSeq;
    (async () => {
      try {
        for (const message of waiting) {
          const response = await fetch(`/api/live/radio-speech?driverId=${driver}&seq=${message.seq}`);
          if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            reportRateLimit(response, data);
            throw new Error(data.error || t.liveRacing.radioFailed);
          }
          const blob = await response.blob();
          // Watching themselves, the driver hears their In-Car AI Coach too, so the two take turns, as for the announcers
          if (mine) {
            if (!(await coachQuiet(meRef))) continue;
            const ms = await mp3DurationMs(blob);
            await fetch('/api/live/announcing', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ms: ms + HOLD_LEAD_MS + HOLD_MARGIN_MS }),
            }).catch(() => undefined);
            await delay(HOLD_LEAD_MS);
          }
          await playMp3(blob);
        }
        setRadioError('');
      } catch (err) {
        setRadioError(err instanceof Error ? err.message : t.liveRacing.radioFailed);
      } finally {
        radioPlaying.current = false;
      }
    })();
  }, [focused, playRadio, t]);

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
        const sessions = sessionFields(group);
        const cars: MapCar[] = group.map((d) => ({
          id: `driver:${d.userId}`,
          label: d.isMe ? t.liveRacing.you : d.driver,
          color: colors.get(d.userId) ?? COLORS[0],
          pct: d.onTrack && !d.offline && d.pct != null ? d.pct : null,
          speed: d.speed ?? 0,
          sampledAt: d.sampledAt,
          moving: d.onTrack && !d.offline,
          highlight: d.isMe,
          dim: !!d.onPitRoad,
        }));
        // The other cars in their sessions, leaving out the watched drivers' own (drawn above)
        for (const session of sessions) {
          const ours = driversInSession(group, session);
          for (const car of session.field.cars) {
            if (ours.has(car.idx) || !car.details) continue;
            cars.push({
              id: `car:${session.key}:${car.idx}`,
              label: car.details.number ?? '',
              color: car.details.classColor ?? '#cbd5e1',
              pct: car.pct ?? null,
              speed: 0,
              rate: car.rate ?? 0,
              sampledAt: session.from.sampledAt,
              moving: true,
              highlight: false,
              fieldCar: true,
              dim: !!car.onPitRoad || !!car.offTrack,
              title: [`#${car.details.number ?? '?'} ${car.details.name}`, car.details.car, car.position ? fmt(t.liveRacing.position, { n: car.position }) : null]
                .filter(Boolean)
                .join(' · '),
            });
          }
        }
        // The lap and time left: each session's, from the driver whose field it is, else the group's first driver's
        const statusOf = (from: Received, field: LiveField | null) => {
          const leader = field ? runningOrder(field.cars)[0] : undefined;
          return (
            <LiveSessionStatus
              lap={leader?.lap ?? from.lap ?? null}
              totalLaps={from.sessionLapsTotal ?? null}
              timeRemain={from.sessionTimeRemain ?? null}
              sampledAt={from.sampledAt}
              counting={!from.offline}
            />
          );
        };
        const focusedHere = focused && group.includes(focused) ? focused : null;
        return (
          <div key={key} className="bg-card rounded-lg border border-border overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <h2 className="text-lg font-semibold text-foreground">{track?.name ?? group[0].track}</h2>
            </div>
            {(sessions.length > 0 ? sessions.map((session) => session.from) : [group.find((d) => !d.offline) ?? group[0]]).map((d) => (
              <LiveSessionBanner key={d.userId} driver={d} driverName={d.isMe ? t.liveRacing.you : d.driver} />
            ))}
            <div className="grid xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)]">
              <div className="order-3 xl:order-1 border-t xl:border-t-0 xl:border-r border-border divide-y divide-border">
                {sessions.length === 0 && <div className="p-3">{statusOf(group[0], null)}</div>}
                {sessions.map((session) => {
                  const ours = driversInSession(group, session);
                  const racingCoachDrivers = new Map<number, LeaderboardDriver>(
                    [...ours].map(([idx, d]) => [idx, { name: d.driver, color: colors.get(d.userId) ?? COLORS[0], isMe: d.isMe }])
                  );
                  return (
                    <div key={session.key} className="py-3 space-y-3">
                      <div className="px-3">{statusOf(session.from, session.field)}</div>
                      <div className="px-3 flex items-baseline gap-2">
                        <h3 className="text-sm font-semibold text-foreground">{t.liveRacing.leaderboard}</h3>
                        <span className="text-xs text-muted-foreground">
                          {[session.from.sessionType, fmt(t.liveRacing.cars, { n: session.field.cars.length })].filter(Boolean).join(' · ')}
                        </span>
                      </div>
                      <LiveLeaderboard field={session.field} isRace={session.isRace} racingCoachDrivers={racingCoachDrivers} />
                    </div>
                  );
                })}
              </div>
              <div className="order-1 xl:order-2 min-w-0">
                <div className="p-4">
                  <div className="aspect-[4/3] w-full">
                    <LiveTrackMap
                      outline={track?.outline ?? null}
                      areas={track?.areas ?? []}
                      cars={cars}
                      startFinishLabel={t.liveRacing.startFinish}
                      lengthMeters={track?.lengthFeet ? track.lengthFeet * METERS_PER_FOOT : null}
                      imageryOpacity={imageryOpacity / 100}
                    />
                  </div>
                  {track?.outline?.kind === 'latlon' && mapSettings?.available && (
                    <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                      {t.liveRacing.satellite}
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={5}
                        value={imageryOpacity}
                        onChange={(event) => changeImageryOpacity(Number(event.target.value))}
                        data-track="liveRacing.satelliteOpacity"
                        className="w-32 accent-primary"
                      />
                      <span className="w-9 tabular-nums">{imageryOpacity}%</span>
                    </label>
                  )}
                  {(!track?.outline || track.approximate) && (
                    <p className="mt-2 text-xs text-muted-foreground">{track?.outline ? t.liveRacing.approximateMap : t.liveRacing.noMap}</p>
                  )}
                </div>
                <ul className="grid sm:grid-cols-2 border-t border-border divide-y sm:divide-y-0 divide-border">
                  {group.map((d) => (
                    <li
                      key={d.userId}
                      onClick={() => setPicked(d.userId)}
                      title={t.liveRacing.showInputs}
                      className={`px-4 py-3 cursor-pointer sm:border-b border-border ${d.offline ? 'opacity-60' : ''} ${
                        d.userId === focus ? 'bg-primary/10' : 'hover:bg-muted/40'
                      }`}
                    >
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
              <div className="order-2 xl:order-3 border-t xl:border-t-0 xl:border-l border-border divide-y divide-border">
                {focusedHere ? (
                  <>
                    <LiveInputs
                      driver={focusedHere.isMe ? t.liveRacing.you : focusedHere.driver}
                      driverId={focusedHere.userId}
                      color={colors.get(focusedHere.userId) ?? COLORS[0]}
                      incidents={focusedHere.incidents ?? null}
                      samples={samples}
                    />
                    <LiveDriverRadio radio={focusedHere.radio ?? []} play={playRadio} onPlayChange={togglePlayRadio} error={radioError} />
                    {showAnnouncers && (
                      <div className="px-4 py-3">
                        <p className="text-sm font-semibold text-foreground">{t.raceAnnouncers.title}</p>
                        <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1">
                          {(['lead', 'color'] as const).map((announcer) => (
                            <label key={announcer} className="inline-flex items-center gap-2 text-sm text-foreground cursor-pointer">
                              <input
                                type="checkbox"
                                checked={announcers[announcer]}
                                onChange={(e) => toggleAnnouncer(announcer, e.target.checked)}
                              />
                              {t.raceAnnouncers[announcer]}
                            </label>
                          ))}
                        </div>
                        {announcerError && <p className="mt-1 text-xs text-red-300">{announcerError}</p>}
                      </div>
                    )}
                    <LiveDriverMessage
                      key={focusedHere.userId}
                      driverId={focusedHere.userId}
                      driver={focusedHere.driver}
                      disabled={!!focusedHere.offline}
                    />
                  </>
                ) : (
                  <p className="px-4 py-3 text-sm text-muted-foreground">{t.liveRacing.showInputs}</p>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
