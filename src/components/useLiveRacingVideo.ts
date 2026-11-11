'use client';

import { useEffect, useRef, useState } from 'react';
import type { LiveDriver } from '@/lib/liveRacing';
import { DEFAULT_LIVE_VIDEO_SETTINGS, type LiveVideoSettings } from '@/lib/liveVideo/broadcastSource';
import type { ViewerStream } from '@/lib/liveVideo/broadcastSourceRuntime';
import { rateBetween, TimelineBuffer } from '@/lib/liveVideo/broadcastTimeline';

// The Live Racing page's live video (docs/live-video.md): the OBS streams of the drivers the user may watch, from
// GET /api/live/video every POLL_MS while the page is showing (the server answers from its own cache, so this never
// reaches Cloudflare per viewer), and the drivers as they were delayMs ago, for a map synchronized with the video.

const POLL_MS = 15_000;

export type LiveRacingVideo = {
  enabled: boolean;
  streams: ViewerStream[];
  settings: Pick<LiveVideoSettings, 'sync' | 'obsVolume' | 'duckLevel'>;
  // Server minus this page's clock (ms), for the player's measured latency
  clockOffset: number;
};

export function useLiveRacingVideo(): LiveRacingVideo {
  const [video, setVideo] = useState<LiveRacingVideo>({
    enabled: false,
    streams: [],
    settings: { sync: DEFAULT_LIVE_VIDEO_SETTINGS.sync, obsVolume: DEFAULT_LIVE_VIDEO_SETTINGS.obsVolume, duckLevel: DEFAULT_LIVE_VIDEO_SETTINGS.duckLevel },
    clockOffset: 0,
  });
  useEffect(() => {
    let stopped = false;
    let timer = 0;
    const poll = async () => {
      if (document.visibilityState === 'visible') {
        try {
          const response = await fetch('/api/live/video', { cache: 'no-store' });
          if (response.ok) {
            const data = await response.json();
            if (!stopped) {
              setVideo((current) => ({
                enabled: !!data.enabled,
                streams: data.streams ?? [],
                settings: data.settings ?? current.settings,
                clockOffset: typeof data.serverNow === 'number' ? data.serverNow - Date.now() : current.clockOffset,
              }));
            }
          }
        } catch {
          // asked again at the next poll; the page carries on without video
        }
      }
      if (!stopped) timer = window.setTimeout(poll, POLL_MS);
    };
    poll();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, []);
  return video;
}

type Timed = LiveDriver & { sampledAt: number };

// The drivers as the page received them delayMs ago, each one's position dated delayMs later so the map's dots move on
// from there, at the pace they went to the next update (already received). 0: the drivers as they are
export function useDelayedDrivers<T extends Timed>(drivers: T[] | null, delayMs: number): T[] | null {
  const buffer = useRef(new TimelineBuffer<T[]>(95_000, 400));
  const seq = useRef(0);
  const [shown, setShown] = useState<T[] | null>(null);
  const latest = useRef(drivers);
  useEffect(() => {
    latest.current = drivers;
    if (drivers) buffer.current.push(performance.now(), ++seq.current, drivers);
  }, [drivers]);
  const delayRef = useRef(delayMs);
  useEffect(() => {
    delayRef.current = delayMs;
  });
  const delaying = delayMs > 0;
  useEffect(() => {
    if (!delaying) return;
    let last: number | null = null;
    const timer = window.setInterval(() => {
      const delayMs = delayRef.current;
      const t = performance.now() - delayMs;
      const frame = buffer.current.frameAt(t);
      if (!frame || frame.before.at === last) return;
      last = frame.before.at;
      const after = new Map((frame.after?.value ?? []).map((d) => [d.userId, d]));
      setShown(
        frame.before.value.map((d) => {
          const next = after.get(d.userId);
          const rate = next && d.speed != null ? rateBetween(d.pct ?? null, d.sampledAt, next.pct ?? null, next.sampledAt) : null;
          // Only the watched drivers' own dots: the field's cars keep their own rates, as sent
          return { ...d, sampledAt: d.sampledAt + delayMs, ...(rate != null ? { syncedRate: rate } : {}) };
        })
      );
    }, 250);
    return () => window.clearInterval(timer);
  }, [delaying]);
  return delaying && shown ? shown : drivers;
}
