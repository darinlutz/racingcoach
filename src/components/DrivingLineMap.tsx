'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';

import { useLanguage } from '@/components/LanguageProvider';
import type { PedalTraceLap } from '@/components/PedalTraces';
import TrackLineMap from '@/components/TrackLineMap';
import { useMapSettings } from '@/lib/satelliteImagery';

// deck.gl is large, so it's only downloaded once someone picks the 3D view
const TrackLineMap3D = dynamic(() => import('@/components/TrackLineMap3D'), { ssr: false });

type Mode = '2d' | '3d';

// Lap Compare's driving line map for one focus area: the flat satellite map (TrackLineMap), or, when
// Google's Photorealistic 3D Tiles are set up (GOOGLE_MAP_TILES_API_KEY), the 3D view (TrackLineMap3D),
// picked with the Map / 3D switch in the legend row. Each focus area keeps its own choice, so only the
// areas where 3D was picked open a WebGL view (and a Google 3D Tiles session).
export default function DrivingLineMap(props: {
  base: PedalTraceLap;
  compare: PedalTraceLap;
  width: number;
  height: number;
  hoverPct: number | null;
  onHover: (pct: number | null) => void;
}) {
  const { t } = useLanguage();
  const settings = useMapSettings();
  const [mode, setMode] = useState<Mode>('2d');
  const apiKey = settings?.google3dKey ?? null;

  const button = (value: Mode, label: string) => (
    <button
      type="button"
      aria-pressed={mode === value}
      onClick={() => setMode(value)}
      className={`px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
        mode === value ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {label}
    </button>
  );
  const toggle = apiKey && (
    <span role="group" aria-label={t.charts.mapView} className="ml-auto inline-flex overflow-hidden rounded-md border border-border">
      {button('2d', t.charts.map2d)}
      {button('3d', t.charts.map3d)}
    </span>
  );

  return mode === '3d' && apiKey ? (
    <TrackLineMap3D {...props} apiKey={apiKey} headerExtra={toggle} />
  ) : (
    <TrackLineMap {...props} headerExtra={toggle} />
  );
}
