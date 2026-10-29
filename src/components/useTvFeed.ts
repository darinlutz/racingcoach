'use client';

import { useEffect, useRef, useState } from 'react';
import type { TvState } from '@/lib/tvBroadcast';

// TV Broadcast Mode's live race (src/lib/tvBroadcast.ts): GET /api/tv/stream (Server-Sent Events), opened again after
// it drops (the browser does that itself, and this does too when nothing arrives for WATCHDOG_MS or the TV comes back
// online). Where the stream fails STREAM_FAILURES times in a row without ever delivering, the TV asks
// GET /api/tv/state every second instead (status 'fallback'). Calls onUnpaired once the TV session was revoked or
// expired. A new driver opens a new stream.

export type FeedStatus = 'connecting' | 'live' | 'reconnecting' | 'fallback';

const WATCHDOG_MS = 25_000;
const STREAM_FAILURES = 3;
const POLL_MS = 1000;

async function stillPaired(): Promise<boolean> {
  try {
    const response = await fetch('/api/tv/session', { cache: 'no-store' });
    return response.status !== 401;
  } catch {
    // offline: assume still paired
    return true;
  }
}

// A picture of the race with when this page received it (performance.now()), which the map's dots and the inputs
// count their ages from
export type ReceivedTvState = TvState & { receivedAt: number };

export function useTvFeed(driver: number | null, onUnpaired: () => void): { state: ReceivedTvState | null; status: FeedStatus } {
  const [state, setState] = useState<ReceivedTvState | null>(null);
  const [status, setStatus] = useState<FeedStatus>('connecting');
  const unpaired = useRef(onUnpaired);
  useEffect(() => {
    unpaired.current = onUnpaired;
  });
  // Stays on the fallback once there, for this page
  const fallback = useRef(false);

  useEffect(() => {
    let stopped = false;
    let source: EventSource | null = null;
    let watchdog = 0;
    let pollTimer = 0;
    let failures = 0;
    let delivered = false;
    const query = driver ? `?driver=${driver}` : '';

    const receive = (text: string) => {
      try {
        setState({ ...(JSON.parse(text) as TvState), receivedAt: performance.now() });
      } catch {
        // a broken message: the next one replaces it
      }
    };

    const poll = async () => {
      if (stopped) return;
      try {
        const response = await fetch(`/api/tv/state${query}`, { cache: 'no-store' });
        if (response.status === 401) {
          unpaired.current();
          return;
        }
        if (response.ok) {
          receive(await response.text());
          setStatus('fallback');
        } else {
          setStatus('reconnecting');
        }
      } catch {
        setStatus('reconnecting');
      }
      if (!stopped) pollTimer = window.setTimeout(poll, POLL_MS);
    };

    const armWatchdog = () => {
      window.clearTimeout(watchdog);
      watchdog = window.setTimeout(() => {
        // Nothing for too long, not even a ping: a stuck connection
        source?.close();
        setStatus('reconnecting');
        open();
      }, WATCHDOG_MS);
    };

    const open = () => {
      if (stopped) return;
      if (fallback.current || typeof EventSource === 'undefined') {
        fallback.current = true;
        poll();
        return;
      }
      source?.close();
      source = new EventSource(`/api/tv/stream${query}`);
      armWatchdog();
      source.onmessage = (event) => {
        delivered = true;
        failures = 0;
        armWatchdog();
        receive(event.data);
        setStatus('live');
      };
      source.addEventListener('ping', () => {
        armWatchdog();
        setStatus('live');
      });
      source.addEventListener('unpaired', () => {
        source?.close();
        unpaired.current();
      });
      source.onerror = async () => {
        if (stopped) return;
        setStatus('reconnecting');
        // The browser retries by itself unless the server refused the stream (401, 500): then check why
        if (source?.readyState !== EventSource.CLOSED) return;
        window.clearTimeout(watchdog);
        if (!(await stillPaired())) {
          unpaired.current();
          return;
        }
        failures++;
        if (!delivered && failures >= STREAM_FAILURES) {
          fallback.current = true;
          poll();
          return;
        }
        window.setTimeout(open, Math.min(30_000, 2000 * failures));
      };
    };

    const online = () => {
      if (fallback.current) return;
      source?.close();
      open();
    };
    window.addEventListener('online', online);
    open();
    return () => {
      stopped = true;
      source?.close();
      window.clearTimeout(watchdog);
      window.clearTimeout(pollTimer);
      window.removeEventListener('online', online);
    };
  }, [driver]);

  return { state, status };
}
