import { formatClouds, formatTempF, formatWind } from '@/lib/stintExport';
import type { StintLap } from '@/lib/stintExport';
import { stintConditions } from '@/lib/stintStats';

// Average weather over the analyzed laps of a stint
export default function StintConditions({ laps }: { laps: StintLap[] }) {
  const c = stintConditions(laps);
  const tiles = [
    {
      label: 'Avg track temp',
      value: formatTempF(c.trackTempC),
      detail: `${formatTempF(c.minTrackTempC)} – ${formatTempF(c.maxTrackTempC)}`,
    },
    { label: 'Avg air temp', value: formatTempF(c.airTempC) },
    { label: 'Avg humidity', value: `${Math.round(c.relativeHumidity * 100)}%` },
    { label: 'Avg wind', value: formatWind(c.windVelocity, c.windDirection) },
    {
      label: 'Clouds',
      value: c.clouds.length === 1 ? formatClouds(c.clouds[0].value) : 'Changed',
      detail:
        c.clouds.length === 1
          ? 'All laps'
          : c.clouds.map((cloud) => `${formatClouds(cloud.value)} (${cloud.laps})`).join(', '),
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
