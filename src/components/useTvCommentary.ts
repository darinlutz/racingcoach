'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import type { Announcer } from '@/lib/raceAnnouncer';
import { CommentaryQueue } from '@/lib/tvAudio';
import type { TvFocus } from '@/lib/tvBroadcast';

// TV Broadcast Mode's Race Announcers: when the followed driver's race events move on (eventSeq), the TV asks
// POST /api/tv/announcer for commentary on the new ones (the Commentary Director, src/lib/broadcastDirector.ts,
// decides what's said), one request at a time, and plays the MP3 lines one after another on the one audio element
// Start Broadcast unlocked (CommentaryQueue: never two at once, a line that waited too long or outlived its moment
// dropped, a more important commentary replacing less important lines still waiting), each at the TV's volume times
// the account's announcer volume. Events from before the TV started following the driver or session, or while the
// commentary was off or the TV showed something else, are skipped, never commentated late; the server also remembers
// what each TV heard, so a reconnect or reload doesn't repeat it. When the TV follows its own account's driving, a
// line waits for their In-Car AI Coach to finish and holds it while it plays (POST /api/tv/announcing), as on the
// Live Racing page.

export type CommentarySettings = { started: boolean; enabled: boolean; lead: boolean; color: boolean; volume: number; muted: boolean };

const HOLD_LEAD_MS = 700;
const HOLD_MARGIN_MS = 300;
const COACH_WAIT_MS = 15_000;
// After a refusal: how long before asking again
const RATE_LIMIT_PAUSE_MS = 60_000;
const ERROR_PAUSE_MS = 10_000;

const delay = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

function base64Blob(base64: string, type: string): Blob {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type });
}

// Loads src and resolves with its length in ms (a guess when the browser can't tell)
function loadDuration(audio: HTMLAudioElement, src: string): Promise<number> {
  return new Promise((resolve) => {
    const done = (ms: number) => {
      audio.onloadedmetadata = null;
      audio.onerror = null;
      window.clearTimeout(timer);
      resolve(ms);
    };
    const timer = window.setTimeout(() => done(8000), 3000);
    audio.onloadedmetadata = () => done(Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : 8000);
    audio.onerror = () => done(0);
    audio.src = src;
    audio.load();
  });
}

// Plays what's loaded, resolving when it ends, fails or is paused
function playToEnd(audio: HTMLAudioElement): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      audio.onended = null;
      audio.onpause = null;
      audio.onerror = null;
      resolve();
    };
    audio.onended = done;
    audio.onpause = done;
    audio.onerror = done;
    audio.play().catch(done);
  });
}

export function useTvCommentary(
  focus: TvFocus | null,
  settings: CommentarySettings,
  audioRef: RefObject<HTMLAudioElement | null>
): { speaking: { speaker: Announcer; text: string } | null; problem: string; paused: boolean } {
  const { t } = useLanguage();
  const [speaking, setSpeaking] = useState<{ speaker: Announcer; text: string } | null>(null);
  const [problem, setProblem] = useState('');
  const [visible, setVisible] = useState(true);
  const seen = useRef<{ driverId: number; sessionKey: string; seq: number } | null>(null);
  const asking = useRef(false);
  const playing = useRef(false);
  const queue = useRef(new CommentaryQueue());
  // Bumped to stop whatever is playing (a new driver or session, the TV hidden, commentary turned off)
  const generation = useRef(0);
  const pausedUntil = useRef(0);
  const disabled = useRef(false);
  const focusRef = useRef(focus);
  const settingsRef = useRef(settings);
  useEffect(() => {
    focusRef.current = focus;
    settingsRef.current = settings;
  });

  const stop = useCallback(() => {
    generation.current++;
    queue.current.clear();
    audioRef.current?.pause();
    setSpeaking(null);
  }, [audioRef]);

  const playQueue = useCallback(async () => {
    if (playing.current) return;
    playing.current = true;
    const run = generation.current;
    try {
      for (;;) {
        const audio = audioRef.current;
        const line = queue.current.next(Date.now());
        if (!audio || !line || run !== generation.current) break;
        const mine = focusRef.current?.isMe ?? false;
        if (mine) {
          // The driver hears their In-Car AI Coach in the car: wait for it, and drop the line if it talks too long
          const until = Date.now() + COACH_WAIT_MS;
          while (focusRef.current?.coachSpeaking && !focusRef.current.offline && Date.now() < until) await delay(200);
          if (focusRef.current?.coachSpeaking || run !== generation.current) continue;
        }
        const url = URL.createObjectURL(base64Blob(line.audio, 'audio/mpeg'));
        try {
          const ms = await loadDuration(audio, url);
          if (run !== generation.current) break;
          if (mine && ms > 0) {
            await fetch('/api/tv/announcing', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ms: ms + HOLD_LEAD_MS + HOLD_MARGIN_MS }),
            }).catch(() => undefined);
            await delay(HOLD_LEAD_MS);
            if (run !== generation.current) break;
          }
          setSpeaking({ speaker: line.speaker, text: line.text });
          audio.volume = (Math.min(Math.max(settingsRef.current.volume, 0), 100) / 100) * (line.volume ?? 1);
          await playToEnd(audio);
        } finally {
          URL.revokeObjectURL(url);
          if (run === generation.current) setSpeaking(null);
        }
      }
    } finally {
      playing.current = false;
    }
  }, [audioRef]);

  // Silence when the TV shows something else (the Home button, another app) or the page goes away; what happened
  // meanwhile isn't commentated later
  useEffect(() => {
    const onVisibility = () => {
      const shown = document.visibilityState === 'visible';
      setVisible(shown);
      if (!shown) stop();
    };
    window.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', stop);
    return () => {
      window.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', stop);
    };
  }, [stop]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = Math.min(Math.max(settings.volume, 0), 100) / 100;
    audio.muted = settings.muted;
  }, [settings.volume, settings.muted, settings.started, audioRef]);

  const on = settings.started && settings.enabled && (settings.lead || settings.color);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- turning the commentary off silences it at once
    if (!on) stop();
  }, [on, stop]);

  useEffect(() => {
    if (!focus) return;
    const s = seen.current;
    // A new driver or session, or the server started over (its event numbers too): start from now
    if (!s || s.driverId !== focus.driverId || s.sessionKey !== focus.sessionKey || focus.eventSeq < s.seq) {
      if (s && (s.driverId !== focus.driverId || s.sessionKey !== focus.sessionKey)) stop();
      seen.current = { driverId: focus.driverId, sessionKey: focus.sessionKey, seq: focus.eventSeq };
      return;
    }
    if (!on || !visible || focus.offline || disabled.current || Date.now() < pausedUntil.current) {
      s.seq = Math.max(s.seq, focus.eventSeq);
      return;
    }
    if (focus.eventSeq <= s.seq || asking.current) return;
    asking.current = true;
    const driverId = focus.driverId;
    const latest = focus.eventSeq;
    (async () => {
      try {
        const response = await fetch('/api/tv/announcer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ driverId, after: s.seq, lead: settings.lead, color: settings.color }),
        });
        const data = await response.json().catch(() => ({}));
        if (seen.current?.driverId === driverId) seen.current.seq = Math.max(seen.current.seq, latest, data.seq ?? 0);
        if (!response.ok) {
          if (data.code === 'aiFeaturesDisabled') {
            disabled.current = true;
            setProblem(t.tv.aiDisabled);
          } else {
            pausedUntil.current = Date.now() + (response.status === 429 ? RATE_LIMIT_PAUSE_MS : ERROR_PAUSE_MS);
            setProblem(data.error || t.tv.commentaryFailed);
          }
          return;
        }
        setProblem('');
        if (seen.current?.driverId !== driverId) return;
        const now = Date.now();
        type Line = { speaker: Announcer; text: string; audio: string; priority?: number; ttlMs?: number; volume?: number };
        queue.current.push(
          ((data.lines ?? []) as Line[]).map((l) => ({ ...l, expiresAt: l.ttlMs != null ? now + l.ttlMs : undefined })),
          now,
          !!data.replaceQueued
        );
        playQueue();
      } catch {
        pausedUntil.current = Date.now() + ERROR_PAUSE_MS;
        setProblem(t.tv.commentaryFailed);
      } finally {
        asking.current = false;
      }
    })();
  }, [focus, on, visible, settings.lead, settings.color, stop, playQueue, t]);

  return { speaking, problem, paused: settings.started && !visible };
}
