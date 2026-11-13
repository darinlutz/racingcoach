'use client';

import { useEffect } from 'react';
import LiveOBSPlayer, { type PlayerMetrics } from '@/components/LiveOBSPlayer';
import type { TvLiveVideo, ViewerStream } from '@/lib/liveVideo/broadcastSourceRuntime';

// TV Broadcast Mode's OBS live video (docs/live-video.md): always on screen, in its own panel beside the track map,
// like the Live Racing page's Split view. Nothing switches it: the Broadcast Director's recorded clips take the map's
// panel only (BroadcastVideoSwitcher), so the player is never hidden, covered or remounted. While the stream isn't
// live the player shows its own offline card, and plays again by itself when OBS comes back.
//
// Audio: the stream's own sound (the game's engine) at the Admin page's OBS volume times the TV's, lowered while an
// announcer speaks or a recorded clip plays; the announcers have their own audio element.

export default function TvObsPanel({
  stream,
  liveVideo,
  clockOffset,
  volume,
  muted,
  started,
  quiet,
  videoSound,
  onMetrics,
}: {
  stream: ViewerStream;
  liveVideo: TvLiveVideo;
  clockOffset: number;
  // The TV's own volume (0-100) and mute
  volume: number;
  muted: boolean;
  // Start Broadcast was pressed (the browser lets the page play sound)
  started: boolean;
  // An announcer is speaking, or a recorded clip is playing beside it
  quiet: boolean;
  // The TV's Video sound setting
  videoSound: boolean;
  onMetrics: (metrics: PlayerMetrics | null) => void;
}) {
  const playable = !!stream.playback;
  useEffect(() => {
    if (!playable) onMetrics(null);
  }, [playable, onMetrics]);
  useEffect(() => () => onMetrics(null), [onMetrics]);

  const obsVolume = (liveVideo.obsVolume / 100) * (Math.min(Math.max(volume, 0), 100) / 100) * (quiet ? liveVideo.duckLevel : 1);
  return (
    <LiveOBSPlayer
      src={stream.playback?.hls ?? null}
      sourceKey={stream.id}
      serverStatus={stream.status}
      muted={muted || !started || !videoSound}
      volume={obsVolume}
      controls={false}
      clockOffset={clockOffset}
      onMetrics={onMetrics}
      size="tv"
      fill
      className="rounded-xl"
    />
  );
}
