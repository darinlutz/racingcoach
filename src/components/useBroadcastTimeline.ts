'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { PlayerMetrics } from '@/components/LiveOBSPlayer';
import type { ReceivedTvState } from '@/components/useTvFeed';
import type { LiveVideoSettings } from '@/lib/liveVideo/broadcastSource';
import { effectiveDelay, rateBetween, smoothDelay, syncErrorMs, TimelineBuffer, type DelayResult, type TimelineStats } from '@/lib/liveVideo/broadcastTimeline';
import type { TvMapCar } from '@/lib/tvBroadcast';

// TV Broadcast Mode's synchronized timeline (docs/live-video.md, src/lib/liveVideo/broadcastTimeline.ts). While the
// Admin page's synchronized broadcast is on and a stream is showing, the TV keeps its last few tens of seconds of
// pictures (each stamped with the server time it was made) and shows the one from as far behind live as the video
// is, so the map, leaderboard, header, events and inputs show the moment the video does. Between pictures the map
// moves each car at the pace it actually went to the next picture, already in the buffer, rather than guessing.
// The Broadcast Director's clip schedule and the camera choice aren't delayed: they're already on absolute times.
// Off, or with nothing to sync to, the live picture is passed straight through, so nothing is delayed for anyone who
// hasn't turned synchronization on.

const STEP_MS = 250;

export type TimelineView = {
  state: ReceivedTvState | null;
  delay: DelayResult;
  appliedDelayMs: number;
  // The buffer doesn't reach back as far as the delay yet (just turned on, or after a reconnect)
  filling: boolean;
  spanMs: number;
  stats: TimelineStats;
  syncErrorMs: number | null;
};

// The picture before, its cars set going at the pace they really went to the picture after
function delayedPicture(before: ReceivedTvState, after: ReceivedTvState | null, live: ReceivedTvState, serverT: number): ReceivedTvState {
  const nowPerf = performance.now();
  // As if this picture arrived (serverT - before.at) ago, so everything that counts from receivedAt (the map's dots,
  // the inputs' trace) lands at serverT
  const receivedAt = nowPerf - Math.max(serverT - before.at, 0);
  const focus = before.focus;
  if (!focus) return { ...before, receivedAt, clockOffset: live.clockOffset };
  const later = new Map((after?.focus?.mapCars ?? []).map((c) => [c.id, c]));
  const mapCars: TvMapCar[] = focus.mapCars.map((car) => {
    const next = later.get(car.id);
    if (!next || !after) return car;
    const rate = rateBetween(car.pct, before.at - car.ageMs, next.pct, after.at - next.ageMs);
    return rate == null ? car : { ...car, rate };
  });
  return {
    ...before,
    receivedAt,
    clockOffset: live.clockOffset,
    // What's on screen, and what the camera is, follow the live schedule
    focus: { ...focus, mapCars, director: live.focus?.director ?? null, liveVideo: live.focus?.liveVideo ?? null },
  };
}

export function useBroadcastTimeline(live: ReceivedTvState | null, sync: LiveVideoSettings['sync'] | null, metrics: PlayerMetrics | null, streamShowing: boolean): TimelineView {
  const maxBufferMs = sync?.maxBufferMs ?? 45_000;
  const buffer = useRef(new TimelineBuffer<ReceivedTvState>(maxBufferMs + 5000));
  const [view, setView] = useState<ReceivedTvState | null>(null);
  const applied = useRef(0);
  const shown = useRef<number | null>(null);
  const liveRef = useRef(live);
  const driver = live?.focus?.driverId ?? null;
  useEffect(() => {
    liveRef.current = live;
  });

  const delay = useMemo(
    () =>
      effectiveDelay({
        syncEnabled: !!sync?.enabled && streamShowing,
        mode: sync?.mode ?? 'auto',
        manualOffsetMs: sync?.manualOffsetMs ?? 0,
        maxBufferMs,
        measuredLatencyMs: metrics?.measuredLatencyMs ?? null,
        estimatedLatencyMs: metrics?.latencyS != null ? metrics.latencyS * 1000 : null,
      }),
    [sync?.enabled, sync?.mode, sync?.manualOffsetMs, maxBufferMs, metrics?.measuredLatencyMs, metrics?.latencyS, streamShowing]
  );
  const delayRef = useRef(delay);
  useEffect(() => {
    delayRef.current = delay;
  });

  useEffect(() => {
    buffer.current.setMaxAge(maxBufferMs + 5000);
  }, [maxBufferMs]);

  // A different driver is a different race: nothing of the last one is shown
  useEffect(() => {
    buffer.current.clear();
    shown.current = null;
  }, [driver]);

  useEffect(() => {
    if (live) buffer.current.push(live.at, live.at, live);
  }, [live]);

  // The delay applied (smoothed toward the one wanted) and the buffer's figures, as last stepped
  const [appliedMs, setAppliedMs] = useState(0);
  const [figures, setFigures] = useState<{ spanMs: number; stats: TimelineStats }>({ spanMs: 0, stats: { received: 0, duplicates: 0, outOfOrder: 0, tooOld: 0, late: 0 } });
  const on = delay.delayMs > 0 || appliedMs > 0;
  useEffect(() => {
    if (!on) {
      applied.current = 0;
      shown.current = null;
      return;
    }
    let steps = 0;
    const timer = window.setInterval(() => {
      const current = liveRef.current;
      if (!current) return;
      const next = smoothDelay(applied.current, delayRef.current.delayMs);
      if (next !== applied.current) setAppliedMs(next);
      applied.current = next;
      if (steps++ % 4 === 0) setFigures({ spanMs: buffer.current.spanMs, stats: { ...buffer.current.stats } });
      if (next <= 0) {
        shown.current = null;
        setView(null);
        return;
      }
      const serverT = Date.now() + current.clockOffset - next;
      const frame = buffer.current.frameAt(serverT);
      if (!frame) return;
      // Only a new picture needs drawing: the map moves the cars by itself in between
      if (shown.current === frame.before.at) return;
      shown.current = frame.before.at;
      setView(delayedPicture(frame.before.value, frame.after?.value ?? null, current, serverT));
    }, STEP_MS);
    return () => window.clearInterval(timer);
  }, [on]);

  const synced = appliedMs > 0 && view ? view : live;
  return {
    state: synced,
    delay,
    appliedDelayMs: appliedMs,
    filling: appliedMs > 0 && figures.spanMs < appliedMs,
    spanMs: figures.spanMs,
    stats: figures.stats,
    syncErrorMs: syncErrorMs(metrics?.measuredLatencyMs ?? null, appliedMs, sync?.manualOffsetMs ?? 0),
  };
}
