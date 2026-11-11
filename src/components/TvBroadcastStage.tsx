'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import LiveOBSPlayer, { type PlayerMetrics } from '@/components/LiveOBSPlayer';
import { cameraAt, isNewerSource, type CameraSource, type SourceSnapshot } from '@/lib/liveVideo/broadcastSource';
import type { TvLiveVideo } from '@/lib/liveVideo/broadcastSourceRuntime';
import type { PlayerStatus } from '@/lib/liveVideo/streamRules';

// TV Broadcast Mode's camera (docs/live-video.md): the live track map, with the OBS live video over it while the
// Broadcast Source Manager says so (TvFocus.liveVideo, the same for every TV watching the session, switching at the
// server time it set). Both stay mounted: the map keeps running underneath, and the player keeps playing while it's
// hidden, so a switch is an opacity change (a cut, or a fade) with no rebuffering and no remount. The Broadcast
// Director's recorded clips (BroadcastVideoSwitcher) go over all of this. This TV falls back to the map by itself when
// its player fails or buffers too long, whatever the server says, so the panel is never blank.
//
// Audio: the OBS stream's own sound (the game's engine) plays only while it's on screen, at the Admin page's OBS volume
// times the TV's, lowered while an announcer speaks; the announcers have their own audio element and carry on across
// every switch.

const CHECK_MS = 200;
const STALL_BACK_TO_MAP_MS = 5000;

export default function TvBroadcastStage({
  liveVideo,
  clockOffset,
  volume,
  muted,
  started,
  speaking,
  videoSound,
  onCamera,
  onMetrics,
  children,
}: {
  liveVideo: TvLiveVideo | null;
  clockOffset: number;
  // The TV's own volume (0-100) and mute
  volume: number;
  muted: boolean;
  // Start Broadcast was pressed (the browser lets the page play sound)
  started: boolean;
  speaking: boolean;
  // The TV's Video sound setting
  videoSound: boolean;
  // What's on screen, for the status pill and the radar
  onCamera: (camera: CameraSource) => void;
  onMetrics: (metrics: PlayerMetrics | null) => void;
  children: ReactNode;
}) {
  const incoming = liveVideo?.source ?? null;
  const [source, setSource] = useState<SourceSnapshot | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- follows the feed; an older snapshot arriving late is ignored
    setSource((current) => (!incoming ? null : isNewerSource(current, incoming) ? incoming : current));
  }, [incoming]);

  const stream = liveVideo?.stream ?? null;
  const [scheduled, setScheduled] = useState<CameraSource>('TRACK_MAP');
  const [playerStatus, setPlayerStatus] = useState<PlayerStatus>('CONNECTING');
  const stalledSince = useRef<number | null>(null);
  const [stalled, setStalled] = useState(false);

  // The camera by the schedule, looked at a few times a second so a switch lands at its time
  useEffect(() => {
    const check = () => {
      setScheduled(source ? cameraAt(source, Date.now() + clockOffset) : 'TRACK_MAP');
      if (playerStatus === 'BUFFERING' || playerStatus === 'CONNECTING') {
        stalledSince.current ??= Date.now();
        setStalled(Date.now() - stalledSince.current > STALL_BACK_TO_MAP_MS);
      } else {
        stalledSince.current = null;
        setStalled(false);
      }
    };
    check();
    const timer = window.setInterval(check, CHECK_MS);
    return () => window.clearInterval(timer);
  }, [source, clockOffset, playerStatus]);

  const playing = playerStatus === 'LIVE' || (playerStatus === 'BUFFERING' && !stalled);
  const obsOnScreen = scheduled === 'OBS_LIVE' && stream?.status === 'LIVE' && !!stream.playback && playing;
  const camera: CameraSource = obsOnScreen ? 'OBS_LIVE' : 'TRACK_MAP';
  useEffect(() => {
    onCamera(camera);
  }, [camera, onCamera]);
  useEffect(() => {
    if (!stream?.playback) onMetrics(null);
  }, [stream?.playback, onMetrics]);

  const fadeMs = source?.fadeMs ?? 0;
  const duck = speaking ? (liveVideo?.duckLevel ?? 0.3) : 1;
  const obsVolume = ((liveVideo?.obsVolume ?? 60) / 100) * (Math.min(Math.max(volume, 0), 100) / 100) * duck;
  return (
    <div className="relative h-full w-full">
      {children}
      {stream?.playback && (
        <div
          className="pointer-events-none absolute inset-0"
          style={{ opacity: obsOnScreen ? 1 : 0, transition: `opacity ${fadeMs}ms` }}
          aria-hidden={!obsOnScreen}
          data-testid={obsOnScreen ? 'obs-on-screen' : 'obs-standby'}
        >
          <LiveOBSPlayer
            src={stream.playback.hls}
            sourceKey={stream.id}
            serverStatus={stream.status}
            active={obsOnScreen}
            muted={muted || !started || !videoSound}
            volume={obsVolume}
            controls={false}
            clockOffset={clockOffset}
            onStatus={setPlayerStatus}
            onMetrics={onMetrics}
            size="tv"
            fill
            className="rounded-xl"
          />
        </div>
      )}
    </div>
  );
}
