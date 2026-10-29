'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import LiveTrackMap, { type MapCar } from '@/components/LiveTrackMap';
import type { MapTrack } from '@/lib/liveMapTrack';
import type { TvMapCar } from '@/lib/tvBroadcast';
import { METERS_PER_FOOT } from '@/lib/units';

// TV Broadcast Mode's track map: the Live Racing page's map (LiveTrackMap) of the followed driver's track, with the
// watched drivers and the other cars in the session going round it, over the satellite imagery when it's set up and
// turned on (Settings). Redrawn at most FPS times a second, without the imagery's sharpening filter, for low-powered
// TVs. The track comes from GET /api/tv/outline, asked again every OUTLINE_RETRY_MS while it's missing or
// approximate, as on the Live Racing page.

const FPS = 20;
const OUTLINE_RETRY_MS = 60_000;
export const SATELLITE_OPACITY = 0.6;

export default function TvMap({
  trackKey,
  approximateFrom,
  cars,
  receivedAt,
  satellite,
}: {
  trackKey: string | null;
  // A watched driver on this track whose collector sent an approximate outline
  approximateFrom: number | null;
  cars: TvMapCar[];
  // When this page received the picture the cars came with (performance.now())
  receivedAt: number;
  satellite: boolean;
}) {
  const { t } = useLanguage();
  const [track, setTrack] = useState<{ key: string; track: MapTrack | null } | null>(null);
  const asked = useRef<{ key: string; at: number; withApproximate: boolean } | null>(null);

  useEffect(() => {
    if (!trackKey) return;
    const known = track?.key === trackKey ? track.track : null;
    if (known?.outline && !known.approximate) return;
    const previous = asked.current?.key === trackKey ? asked.current : null;
    const now = Date.now();
    const due = !previous || now - previous.at > OUTLINE_RETRY_MS || (!!approximateFrom && !previous.withApproximate);
    if (!due) return;
    asked.current = { key: trackKey, at: now, withApproximate: !!approximateFrom };
    const params = new URLSearchParams({ key: trackKey });
    if (approximateFrom) params.set('driver', String(approximateFrom));
    fetch(`/api/tv/outline?${params}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (data) setTrack({ key: trackKey, track: data.track });
      })
      .catch(() => {
        // asked again in a minute
      });
  }, [trackKey, approximateFrom, track, receivedAt]);

  const mapCars = useMemo<MapCar[]>(
    () => cars.map(({ ageMs, ...car }) => ({ ...car, sampledAt: receivedAt - ageMs })),
    [cars, receivedAt]
  );
  const current = track?.key === trackKey ? track.track : null;

  return (
    <div className="relative h-full w-full">
      <LiveTrackMap
        outline={current?.outline ?? null}
        areas={current?.areas ?? []}
        cars={mapCars}
        startFinishLabel={t.liveRacing.startFinish}
        lengthMeters={current?.lengthFeet ? current.lengthFeet * METERS_PER_FOOT : null}
        imageryOpacity={satellite ? SATELLITE_OPACITY : 0}
        maxFps={FPS}
        sharpen={false}
      />
      {(!current?.outline || current.approximate) && (
        <p className="absolute bottom-2 left-3 rounded bg-black/60 px-3 py-1 text-[18px] text-[#c9d1dc]">
          {current?.outline ? t.tv.mapApproximate : t.tv.noMap}
        </p>
      )}
    </div>
  );
}
