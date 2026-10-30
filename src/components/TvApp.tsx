'use client';

import { useEffect, useLayoutEffect, useState } from 'react';
import TvBroadcast from '@/components/TvBroadcast';
import TvPairing from '@/components/TvPairing';
import type { EngineBedConfig } from '@/lib/engineBedConfig';

// TV Broadcast Mode's screen (src/app/tv/): a 1920×1080 stage scaled to fit the TV's browser (Silk on a 1080p or 4K
// Fire TV reports a 960×540 page), over the site's navigation, with a margin inside its edges for TVs that crop them
// (overscan; the Settings panel's Screen edges, kept in the browser). The pairing screen until the TV is paired, then
// the broadcast.

const STAGE_W = 1920;
const STAGE_H = 1080;
// Screen edges: none, a small margin, the TV safe area (5% each side)
export const SCREEN_EDGES = [0, 0.025, 0.05] as const;
const EDGES_KEY = 'tv.screenEdges';
const DEFAULT_EDGES = 1;

// Scales the stage to the window, letterboxed
function useStageScale(): number {
  const [scale, setScale] = useState(0.5);
  useLayoutEffect(() => {
    const fit = () => setScale(Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H));
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);
  return scale;
}

export default function TvApp({
  paired,
  announcers,
  linkAddress,
}: {
  paired: { userName: string; engine: EngineBedConfig } | null;
  // The Admin page's Enable AI Features is on, so the Race Announcers can speak
  announcers: boolean;
  linkAddress: string;
}) {
  const scale = useStageScale();
  const [edges, setEdges] = useState(DEFAULT_EDGES);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(EDGES_KEY);
      const saved = raw == null ? NaN : Number(raw);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read once from browser storage after hydration
      if (Number.isInteger(saved) && saved >= 0 && saved < SCREEN_EDGES.length) setEdges(saved);
    } catch {
      // storage blocked: the default margin
    }
    // The page under the stage doesn't scroll, and the shared parts (the map, the wheel) take Dark Mode's colors,
    // whatever theme this browser last had
    const html = document.documentElement;
    const before = { overflow: html.style.overflow, theme: html.dataset.theme };
    html.style.overflow = 'hidden';
    html.dataset.theme = 'dark';
    return () => {
      html.style.overflow = before.overflow;
      if (before.theme) html.dataset.theme = before.theme;
    };
  }, []);

  const changeEdges = (next: number) => {
    setEdges(next);
    try {
      window.localStorage.setItem(EDGES_KEY, String(next));
    } catch {
      // kept for this visit only
    }
  };

  const inset = SCREEN_EDGES[edges];
  return (
    <div className="fixed inset-0 z-[100] overflow-hidden bg-[#05070a] text-white" data-no-track>
      <div
        className="absolute left-1/2 top-1/2 origin-center"
        style={{
          width: STAGE_W,
          height: STAGE_H,
          transform: `translate(-50%, -50%) scale(${scale})`,
          padding: `${Math.round(STAGE_H * inset)}px ${Math.round(STAGE_W * inset)}px`,
        }}
      >
        {paired ? (
          <TvBroadcast userName={paired.userName} announcers={announcers} engine={paired.engine} edges={edges} onEdges={changeEdges} />
        ) : (
          <TvPairing linkAddress={linkAddress} />
        )}
      </div>
    </div>
  );
}
