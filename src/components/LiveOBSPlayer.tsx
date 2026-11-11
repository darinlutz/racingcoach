'use client';

import { Maximize, Minimize, Radio, Volume2, VolumeX } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type HlsType from 'hls.js';
import { useLanguage } from '@/components/LanguageProvider';
import type { PlayerStatus, StreamStatus } from '@/lib/liveVideo/streamRules';

// The OBS live video player (docs/live-video.md), shared by the Live Racing page, TV Broadcast Mode and the Admin
// page's calibration: a Cloudflare Stream live HLS stream in a 16:9 box, played by hls.js (loaded only when a stream is
// shown) or by the browser itself where it plays HLS natively (Safari, iOS). hls.js rather than Cloudflare's iframe
// player, as the iframe doesn't expose the timing synchronization needs: how far behind live the picture is (latency,
// an estimate) and, when the playlist carries EXT-X-PROGRAM-DATE-TIME, the wall-clock time of the frame on screen
// (playingDate, a measurement).
//
// It recovers by itself: a network error reloads the stream with growing waits, a decoding error asks hls.js to
// recover, anything else starts the player again; a stream that goes offline shows the offline card and starts again
// when it's back. Muted autoplay always works; with sound, a browser that refuses it gets a Tap for sound button. It
// stays mounted when hidden (active false) so switching to it needs no rebuffering, and lets go of the decoder when
// unmounted or the stream goes away.

export type PlayerMetrics = {
  status: PlayerStatus;
  // Estimated seconds behind the live edge (hls.js), or null
  latencyS: number | null;
  // Server now minus the wall-clock time of the frame on screen, when the stream carries it (measured), or null
  measuredLatencyMs: number | null;
  bufferS: number | null;
  droppedFrames: number | null;
  stalls: number;
  // Native HLS (Safari) gives no latency figures
  engine: 'hls.js' | 'native' | 'none';
};

const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 15_000;
const METRICS_MS = 1000;

type Props = {
  // The HLS URL; null while there's nothing to play
  src: string | null;
  // Changes only for a different stream: a new src with the same key (a refreshed signed token) is used at the next
  // reload rather than starting the player again
  sourceKey: string | number | null;
  // The server's view of the stream (Cloudflare's), which decides between the player and the offline card
  serverStatus: StreamStatus;
  active?: boolean;
  muted?: boolean;
  // 0-1
  volume?: number;
  controls?: boolean;
  // Server minus this browser's clock (ms), for the measured latency
  clockOffset?: number;
  onStatus?: (status: PlayerStatus) => void;
  onMetrics?: (metrics: PlayerMetrics) => void;
  // The user pressed the player's own mute button
  onMutedChange?: (muted: boolean) => void;
  size?: 'tv' | 'page';
  // Fills its parent rather than keeping 16:9 (the TV's map panel)
  fill?: boolean;
  className?: string;
};

export default function LiveOBSPlayer({
  src,
  sourceKey,
  serverStatus,
  active = true,
  muted = true,
  volume = 1,
  controls = true,
  clockOffset = 0,
  onStatus,
  onMetrics,
  onMutedChange,
  size = 'page',
  fill = false,
  className = '',
}: Props) {
  const { t, fmt } = useLanguage();
  const v = t.liveVideo;
  const boxRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<HlsType | null>(null);
  const srcRef = useRef(src);
  const offsetRef = useRef(clockOffset);
  const callbacks = useRef({ onStatus, onMetrics });
  const [status, setStatus] = useState<PlayerStatus>('CONNECTING');
  const [blocked, setBlocked] = useState(false);
  const [fullScreen, setFullScreen] = useState(false);
  const [latency, setLatency] = useState<{ s: number; measured: boolean } | null>(null);
  const stalls = useRef(0);
  const engine = useRef<PlayerMetrics['engine']>('none');
  useEffect(() => {
    srcRef.current = src;
    offsetRef.current = clockOffset;
    callbacks.current = { onStatus, onMetrics };
  });

  const playable = serverStatus === 'LIVE' && !!src;
  const report = useCallback((next: PlayerStatus) => {
    setStatus(next);
    callbacks.current.onStatus?.(next);
  }, []);

  // Plays, falling back to muted where the browser wants a press for sound
  const play = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      await video.play();
      setBlocked(false);
    } catch (error) {
      if ((error as Error)?.name === 'NotAllowedError' && !video.muted) {
        video.muted = true;
        setBlocked(true);
        await video.play().catch(() => undefined);
      }
    }
  }, []);

  // The player for this stream: made when it's live, torn down when it isn't or another stream takes its place
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!playable) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the card follows the server's status
      report(serverStatus === 'ERROR' ? 'ERROR' : serverStatus === 'CONNECTING' ? 'CONNECTING' : 'OFFLINE');
      return;
    }
    let stopped = false;
    let retry = 0;
    let timer = 0;
    report('CONNECTING');

    const teardown = () => {
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
    const again = (start: () => void) => {
      if (stopped) return;
      const wait = Math.min(RETRY_MAX_MS, RETRY_MIN_MS * 2 ** retry++);
      window.clearTimeout(timer);
      timer = window.setTimeout(start, wait);
    };

    const start = async () => {
      if (stopped) return;
      teardown();
      const url = srcRef.current;
      if (!url) return;
      const Hls = (await import('hls.js')).default;
      if (stopped) return;
      if (Hls.isSupported()) {
        engine.current = 'hls.js';
        const hls = new Hls({ lowLatencyMode: true, liveSyncDurationCount: 3, maxBufferLength: 30, backBufferLength: 30, enableWorker: true });
        hlsRef.current = hls;
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          retry = 0;
          play();
        });
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal) return;
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            hls.recoverMediaError();
            return;
          }
          // A network error (the stream dropping, an expired token) or anything else: start again, with the newest URL
          report('ERROR');
          again(start);
        });
        hls.loadSource(url);
        hls.attachMedia(video);
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        engine.current = 'native';
        video.src = url;
        video.onerror = () => {
          report('ERROR');
          again(start);
        };
        play();
      } else {
        engine.current = 'none';
        report('ERROR');
      }
    };
    start();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      teardown();
      video.onerror = null;
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
    // a new src for the same stream is picked up at the next start, so it isn't a dependency
  }, [playable, sourceKey, serverStatus === 'ERROR', report, play]); // eslint-disable-line react-hooks/exhaustive-deps

  // The element's own events tell playing from buffering
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !playable) return;
    const playing = () => report('LIVE');
    const waiting = () => {
      stalls.current++;
      report('BUFFERING');
    };
    video.addEventListener('playing', playing);
    video.addEventListener('waiting', waiting);
    video.addEventListener('stalled', waiting);
    return () => {
      video.removeEventListener('playing', playing);
      video.removeEventListener('waiting', waiting);
      video.removeEventListener('stalled', waiting);
    };
  }, [playable, report]);

  // Volume and mute follow the props; a hidden player stays quiet
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = Math.min(Math.max(volume, 0), 1);
    video.muted = muted || !active;
    if (!muted && active && video.paused && playable) play();
  }, [muted, volume, active, playable, play]);

  // Metrics once a second
  useEffect(() => {
    if (!playable) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- nothing to measure without a stream
      setLatency(null);
      return;
    }
    const timer = window.setInterval(() => {
      const video = videoRef.current;
      const hls = hlsRef.current;
      if (!video) return;
      const estimated = hls && Number.isFinite(hls.latency) && hls.latency > 0 ? hls.latency : null;
      const date = hls?.playingDate;
      const measured = date && Number.isFinite(date.getTime()) ? Date.now() + offsetRef.current - date.getTime() : null;
      const end = video.buffered.length > 0 ? video.buffered.end(video.buffered.length - 1) : null;
      const quality = typeof video.getVideoPlaybackQuality === 'function' ? video.getVideoPlaybackQuality() : null;
      const metrics: PlayerMetrics = {
        status: videoRef.current?.paused ? 'CONNECTING' : status,
        latencyS: estimated,
        measuredLatencyMs: measured != null && measured > 0 && measured < 600_000 ? measured : null,
        bufferS: end != null ? Math.max(end - video.currentTime, 0) : null,
        droppedFrames: quality ? quality.droppedVideoFrames : null,
        stalls: stalls.current,
        engine: engine.current,
      };
      setLatency(metrics.measuredLatencyMs != null ? { s: metrics.measuredLatencyMs / 1000, measured: true } : estimated != null ? { s: estimated, measured: false } : null);
      callbacks.current.onMetrics?.(metrics);
    }, METRICS_MS);
    return () => window.clearInterval(timer);
  }, [playable, status]);

  useEffect(() => {
    const onChange = () => setFullScreen(!!document.fullscreenElement && document.fullscreenElement === boxRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullScreen = () => {
    const box = boxRef.current;
    const video = videoRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => undefined);
    } else if (box?.requestFullscreen) {
      box.requestFullscreen().catch(() => undefined);
    } else {
      // iOS plays full screen on the video element only
      video?.webkitEnterFullscreen?.();
    }
  };

  const unblock = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = false;
    setBlocked(false);
    onMutedChange?.(false);
    play();
  };

  const big = size === 'tv';
  const showCard = !playable || status === 'ERROR';
  return (
    <div ref={boxRef} className={`relative ${fill ? 'h-full' : 'aspect-video'} w-full overflow-hidden bg-black ${className}`} data-testid="obs-player" data-status={status}>
      <video ref={videoRef} playsInline muted autoPlay disablePictureInPicture className="absolute inset-0 h-full w-full object-contain" aria-label={v.tv.obsLive} />
      {showCard && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/80 p-4 text-center" data-testid="obs-offline">
          <Radio size={big ? 56 : 32} className="text-[#8b95a3]" aria-hidden />
          <p className={`${big ? 'text-[30px]' : 'text-base'} font-semibold text-white`}>{status === 'ERROR' && playable ? v.player.errorTitle : v.player.offlineTitle}</p>
          <p className={`${big ? 'text-[22px]' : 'text-xs'} text-[#a7b0bd]`}>{status === 'ERROR' && playable ? v.player.errorHint : v.player.offlineHint}</p>
        </div>
      )}
      {!showCard && (status === 'CONNECTING' || status === 'BUFFERING') && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-live="polite">
          <span className={`animate-spin rounded-full border-4 border-white/30 border-t-white ${big ? 'size-16' : 'size-9'}`} aria-label={v.status[status]} />
        </div>
      )}
      {/* The status and latency, top left */}
      <div className="pointer-events-none absolute left-2 top-2 flex items-center gap-2">
        <span
          className={`rounded px-2 py-0.5 font-bold uppercase tracking-wide ${big ? 'text-[20px]' : 'text-[11px]'} ${status === 'LIVE' ? 'bg-[#e10600] text-white' : 'bg-black/70 text-[#e6ebf2]'}`}
        >
          {v.status[status]}
        </span>
        {latency && status === 'LIVE' && (
          <span className={`rounded bg-black/60 px-2 py-0.5 tabular-nums text-[#e6ebf2] ${big ? 'text-[18px]' : 'text-[11px]'}`}>
            {fmt(latency.measured ? v.player.latencyMeasured : v.player.latency, { s: latency.s.toFixed(1) })}
          </span>
        )}
      </div>
      {blocked && !muted && (
        <button type="button" onClick={unblock} data-tv-focus className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-lg bg-[#e10600] px-4 py-2 text-sm font-semibold text-white">
          {v.player.tapToUnmute}
        </button>
      )}
      {controls && (
        <div className="absolute bottom-2 right-2 flex gap-1">
          {onMutedChange && (
            <button
              type="button"
              onClick={() => onMutedChange(!muted)}
              className="rounded bg-black/60 p-1.5 text-white hover:bg-black/80"
              aria-label={muted ? v.player.unmute : v.player.mute}
              title={muted ? v.player.unmute : v.player.mute}
            >
              {muted ? <VolumeX size={16} aria-hidden /> : <Volume2 size={16} aria-hidden />}
            </button>
          )}
          <button
            type="button"
            onClick={toggleFullScreen}
            className="rounded bg-black/60 p-1.5 text-white hover:bg-black/80"
            aria-label={fullScreen ? v.player.exitFullScreen : v.player.fullScreen}
            title={fullScreen ? v.player.exitFullScreen : v.player.fullScreen}
          >
            {fullScreen ? <Minimize size={16} aria-hidden /> : <Maximize size={16} aria-hidden />}
          </button>
        </div>
      )}
    </div>
  );
}
