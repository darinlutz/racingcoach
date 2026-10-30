'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import { expectedVideoTime, playbackCorrection, type DirectorSnapshot } from '@/lib/videoDirector';

// What fills TV Broadcast Mode's map panel: its children (the live track map), with the Broadcast Director's recorded
// clip over them while the schedule says so (src/lib/videoDirector.ts). The map is never unmounted or paused, so it stays
// live underneath and is there at once when the clip ends. The clip is buffered as soon as it's picked, starts at the
// shared time wherever this TV joins, and keeps to it; this TV falls back to the map by itself when the clip fails or
// buffers too long, and says so (POST /api/tv/director/report). Sound is off unless the clip allows it, and falls back
// to muted when the browser refuses it.

const CHECK_MS = 200;
const DRIFT_CHECK_MS = 1000;
const STALL_BACK_TO_MAP_MS = 3000;
const DUCKED_VOLUME = 0.25;

export default function BroadcastVideoSwitcher({
  director,
  clockOffset,
  volume,
  muted,
  duck,
  onRecordedChange,
  children,
}: {
  director: DirectorSnapshot | null;
  clockOffset: number;
  volume: number;
  muted: boolean;
  duck: boolean;
  onRecordedChange: (recorded: boolean) => void;
  children: ReactNode;
}) {
  const { t } = useLanguage();
  const clip = director?.clip ?? null;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [failed, setFailed] = useState<number | null>(null);
  const directorRef = useRef(director);
  const offsetRef = useRef(clockOffset);
  useEffect(() => {
    directorRef.current = director;
    offsetRef.current = clockOffset;
  });

  const videoId = clip?.videoId ?? null;
  const showClip = videoId !== null && failed !== videoId;
  // A failure only counts for that showing of the clip: the file may be fine next time
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- follows the Director
    if (videoId === null) setFailed(null);
  }, [videoId]);

  const report = (id: number) => {
    setFailed(id);
    fetch('/api/tv/director/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seq: directorRef.current?.seq ?? 0, videoId: id }),
    }).catch(() => undefined);
  };

  // Keeps the player on the schedule
  useEffect(() => {
    if (!showClip) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- nothing on screen once the clip's gone
      setVisible(false);
      return;
    }
    const video = videoRef.current;
    if (!video) return;
    let starting = false;
    let lastDriftCheck = 0;
    let stalledSince: number | null = null;
    const pause = () => {
      if (!video.paused) video.pause();
    };
    const timer = window.setInterval(() => {
      const snapshot = directorRef.current;
      if (!snapshot?.clip) return;
      const serverNow = Date.now() + offsetRef.current;
      const expected = expectedVideoTime(snapshot, serverNow);
      if (expected === null) {
        setVisible(false);
        pause();
        // Sits on its first frame, ready, until the cut
        if (video.readyState >= 1 && snapshot.playbackStartAt === null && Math.abs(video.currentTime - snapshot.clip.clipStartSeconds) > 0.5) {
          video.currentTime = snapshot.clip.clipStartSeconds;
        }
        return;
      }
      if (video.paused && !starting) {
        starting = true;
        if (Math.abs(video.currentTime - expected) > 0.25) video.currentTime = expected;
        video
          .play()
          .catch(() => {
            // The browser wants a button press before sound; the picture doesn't need one
            video.muted = true;
            return video.play();
          })
          .catch(() => report(snapshot.clip!.videoId))
          .finally(() => {
            starting = false;
          });
        return;
      }
      const ready = video.readyState >= 3;
      if (ready) {
        stalledSince = null;
        setVisible(true);
      } else {
        stalledSince ??= serverNow;
        // Buffering this long: the map's better than a frozen picture
        if (serverNow - stalledSince > STALL_BACK_TO_MAP_MS) setVisible(false);
      }
      if (ready && serverNow - lastDriftCheck >= DRIFT_CHECK_MS) {
        lastDriftCheck = serverNow;
        const { seekTo, rate } = playbackCorrection(video.currentTime, expected);
        if (seekTo !== null) video.currentTime = seekTo;
        if (video.playbackRate !== rate) video.playbackRate = rate;
      }
    }, CHECK_MS);
    return () => window.clearInterval(timer);
  }, [showClip, videoId]);

  // Sound: only when the clip has it, under the announcers while they speak
  const audible = !!clip?.audio;
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !audible || muted;
    video.volume = (Math.min(Math.max(volume, 0), 100) / 100) * (duck ? DUCKED_VOLUME : 1);
  }, [audible, muted, volume, duck, showClip]);

  // Lets go of the decoder when the clip's over: low-powered TVs have few of them
  useEffect(() => {
    const video = videoRef.current;
    if (!showClip || !video) return;
    return () => {
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
  }, [showClip, videoId]);

  useEffect(() => {
    onRecordedChange(visible);
  }, [visible, onRecordedChange]);

  const transition = `${director?.transitionMs ?? 300}ms`;
  return (
    <div className="relative h-full overflow-hidden rounded-xl">
      {children}
      {showClip && clip && (
        <video
          key={clip.videoId}
          ref={videoRef}
          src={clip.url}
          preload="auto"
          muted
          playsInline
          disablePictureInPicture
          onError={() => report(clip.videoId)}
          aria-hidden={!visible}
          className="pointer-events-none absolute inset-0 h-full w-full bg-black object-contain"
          style={{ opacity: visible ? 1 : 0, transition: `opacity ${transition}` }}
        />
      )}
      {visible && clip && (
        <p data-testid="recorded-footage" className="absolute left-4 top-4 flex items-center gap-3 rounded-lg bg-black/75 px-4 py-2 text-[22px] font-bold uppercase tracking-wide text-white">
          <span>{t.tv.director.recordedFootage}</span>
          <span className="text-[#ffd400]">{t.tv.director.cameras[clip.category]}</span>
        </p>
      )}
    </div>
  );
}
