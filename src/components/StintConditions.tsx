'use client';

import { useLanguage } from '@/components/LanguageProvider';
import { useUnits } from '@/components/UnitsProvider';
import { formatClouds, formatWind } from '@/lib/stintExport';
import type { StintLap } from '@/lib/stintExport';
import { stintConditions } from '@/lib/stintStats';
import { formatTemperature } from '@/lib/units';

// Average weather over the analyzed laps of a stint
export default function StintConditions({ laps }: { laps: StintLap[] }) {
  const { t } = useLanguage();
  const units = useUnits();
  const c = stintConditions(laps);
  const clouds = (value: number) => formatClouds(value, t.weather.clouds);
  const temp = (celsius: number) => formatTemperature(celsius, units);
  const tiles = [
    {
      label: t.stint.avgTrackTemp,
      value: temp(c.trackTempC),
      detail: `${temp(c.minTrackTempC)} – ${temp(c.maxTrackTempC)}`,
    },
    { label: t.stint.avgAirTemp, value: temp(c.airTempC) },
    { label: t.stint.avgHumidity, value: `${Math.round(c.relativeHumidity * 100)}%` },
    { label: t.stint.avgWind, value: formatWind(c.windVelocity, c.windDirection, units, t.weather.compass) },
    {
      label: t.stint.clouds,
      value: c.clouds.length === 1 ? clouds(c.clouds[0].value) : t.stint.changed,
      detail:
        c.clouds.length === 1
          ? t.stint.allLaps
          : c.clouds.map((cloud) => `${clouds(cloud.value)} (${cloud.laps})`).join(', '),
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
      {tiles.map((tile) => (
        <div key={tile.label} className="bg-card border border-border rounded-lg px-4 py-3">
          <p className="text-xs font-medium text-muted-foreground">{tile.label}</p>
          <p className="text-lg font-semibold text-foreground">{tile.value}</p>
          {tile.detail && <p className="text-xs text-muted-foreground">{tile.detail}</p>}
        </div>
      ))}
    </div>
  );
}
