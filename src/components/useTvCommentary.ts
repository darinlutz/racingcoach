'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import { engineBed, linkSpeech } from '@/lib/engineBed';
import type { Announcer } from '@/lib/raceAnnouncer';
import { CommentaryQueue } from '@/lib/tvAudio';
import type { TvFocus } from '@/lib/tvBroadcast';
import { LATE_LINE_MS, type DirectorSnapshot } from '@/lib/videoDirector';

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
//
// A recorded clip's lines (the Broadcast Director's, src/lib/videoDirector.ts) are different: they play at the times the
// server set, shared by every TV, taking over from any normal commentary. Normal commentary waits while the Director
// holds it; the events it was about are asked about again afterwards, unless they've gone stale.
//
// ElevenLabs lines play over the engine bed (src/lib/engineBed.ts), which this TV mixes itself from the moment its own
// audio element starts playing, so the bed is in step with the line wherever the server's timing put it.

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

type DirectorLine = DirectorSnapshot['lines'][number];

export function useTvCommentary(
  focus: TvFocus | null,
  settings: CommentarySettings,
  audioRef: RefObject<HTMLAudioElement | null>,
  director: DirectorSnapshot | null,
  clockOffset: number
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
  const clockRef = useRef(clockOffset);
  useEffect(() => {
    focusRef.current = focus;
    settingsRef.current = settings;
    clockRef.current = clockOffset;
  });
  // The Director's line playing, the lines already played and their audio, fetched ahead of time
  const directorLine = useRef<string | null>(null);
  const played = useRef(new Set<string>());
  const directorAudio = useRef(new Map<string, Promise<string | null>>());
  // The newest race event the server said could wait for the Director
  const heldSeq = useRef(-1);

  const stop = useCallback(() => {
    generation.current++;
    queue.current.clear();
    audioRef.current?.pause();
    engineBed.silence();
    setSpeaking(null);
  }, [audioRef]);

  const playQueue = useCallback(async () => {
    if (playing.current) return;
    playing.current = true;
    const run = generation.current;
    try {
      for (;;) {
        const audio = audioRef.current;
        // The Director's line has the audio element; this picks up again after it
        if (directorLine.current) break;
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
          const unlink = line.elevenLabs ? linkSpeech(engineBed, audio, () => !!queue.current.peek()?.elevenLabs) : null;
          await playToEnd(audio);
          unlink?.();
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

  const playDirectorLine = useCallback(
    async (line: DirectorLine) => {
      if (played.current.has(line.id)) return;
      played.current.add(line.id);
      // Joined too late for it to make sense
      if (Date.now() + clockRef.current > line.at + LATE_LINE_MS) return;
      const audio = audioRef.current;
      // This takes over from anything else being said
      generation.current++;
      queue.current.clear();
      audio?.pause();
      directorLine.current = line.id;
      if (line.text) setSpeaking({ speaker: line.speaker, text: line.text });
      try {
        const url = await directorAudio.current.get(line.id);
        if (directorLine.current !== line.id) return;
        if (url && audio) {
          if (focusRef.current?.isMe) {
            await fetch('/api/tv/announcing', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ms: line.durationMs + HOLD_MARGIN_MS }),
            }).catch(() => undefined);
          }
          await loadDuration(audio, url);
          if (directorLine.current !== line.id) return;
          audio.volume = (Math.min(Math.max(settingsRef.current.volume, 0), 100) / 100) * line.volume;
          const unlink = line.elevenLabs ? linkSpeech(engineBed, audio) : null;
          await playToEnd(audio);
          unlink?.();
        } else if (line.text) {
          // No sound for this TV: the words stay up as long as the others are hearing them
          await delay(line.durationMs);
        }
      } finally {
        if (directorLine.current === line.id) {
          directorLine.current = null;
          setSpeaking(null);
          playQueue();
        }
      }
    },
    [audioRef, playQueue]
  );

  // Each line of the Director's sequence, at its time, whatever the others are doing. A line that's gone from the
  // schedule (the clip was cancelled or cut short) stops
  const lines = director?.lines;
  const directorSeq = director?.seq;
  useEffect(() => {
    const scheduled = lines ?? [];
    if (directorLine.current && !scheduled.some((l) => l.id === directorLine.current)) {
      directorLine.current = null;
      audioRef.current?.pause();
      setSpeaking(null);
      playQueue();
    }
    if (!on || !visible) return;
    const timers: number[] = [];
    for (const line of scheduled) {
      if (played.current.has(line.id) || (line.speaker === 'lead' ? !settings.lead : !settings.color)) continue;
      if (line.audioUrl && !directorAudio.current.has(line.id)) {
        directorAudio.current.set(
          line.id,
          fetch(line.audioUrl)
            .then((response) => (response.ok ? response.blob() : null))
            .then((blob) => (blob ? URL.createObjectURL(blob) : null))
            .catch(() => null)
        );
      }
      timers.push(window.setTimeout(() => playDirectorLine(line), Math.max(line.at - (Date.now() + clockRef.current), 0)));
    }
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [directorSeq, lines, on, visible, settings.lead, settings.color, audioRef, playDirectorLine, playQueue]);

  // Audio of sequences that are over
  useEffect(() => {
    if (directorSeq === undefined || (lines?.length ?? 0) > 0) return;
    for (const [id, url] of directorAudio.current) {
      directorAudio.current.delete(id);
      url.then((u) => u && URL.revokeObjectURL(u));
    }
    played.current.clear();
  }, [directorSeq, lines]);

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
    // Told this can wait for the Director: nothing to ask until something newer happens or it lets go
    if (focus.director?.hold && heldSeq.current === focus.eventSeq) return;
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
        if (response.ok && data.held) {
          heldSeq.current = latest;
          return;
        }
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
        // Preferences changed since this broadcast started take effect without reloading the TV
        if (data.engineBed) engineBed.configure(data.engineBed);
        type Line = { speaker: Announcer; text: string; audio: string; priority?: number; ttlMs?: number; volume?: number; elevenLabs?: boolean };
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
