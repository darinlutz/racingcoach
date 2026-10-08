import type { ReactNode } from 'react';

import {
  formatClouds,
  formatPressure,
  formatSeconds,
  formatTempF,
  formatWind,
  type StintExport,
} from '@/lib/stintExport';

type WeatherTableProps = {
  stint: StintExport;
  onRemove: () => void;
  note?: string;
  isHighlighted?: (lapSeconds: number) => boolean;
  showWetness?: boolean; // the Precip. and Wetness columns
  summary?: ReactNode; // shown between the heading and the table
};

const WETNESS_HEADINGS = ['Precip.', 'Wetness'];
const HEADINGS = [
  'Lap', 'Lap time', 'Started', 'Clean', 'Track temp', 'Air temp', 'Humidity', 'Wind', 'Clouds',
  'Pressure', ...WETNESS_HEADINGS, 'Track usage',
];

// Per-lap weather from a Garage 61 stint export
export default function WeatherTable({ stint, onRemove, note, isHighlighted, showWetness = true, summary }: WeatherTableProps) {
  const headings = showWetness ? HEADINGS : HEADINGS.filter((h) => !WETNESS_HEADINGS.includes(h));
  const trackTemps = stint.laps.map((lap) => lap.trackTempC);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-medium text-foreground">
          Weather conditions <span className="font-normal text-muted-foreground">({stint.fileName})</span>
        </p>
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove stint export"
          className="ml-3 text-muted-foreground hover:text-primary"
        >
          ✕
        </button>
      </div>
      <p className="text-sm text-muted-foreground mb-2">
        Track temp {formatTempF(Math.min(...trackTemps))} – {formatTempF(Math.max(...trackTemps))} over the stint.
        {note && ` ${note}`}
      </p>
      {summary}
      <div className="overflow-x-auto bg-card border border-border rounded-lg">
        <table className="w-full text-sm text-foreground whitespace-nowrap">
          <thead className="bg-secondary text-left text-muted-foreground">
            <tr>
              {headings.map((heading) => (
                <th key={heading} className="px-3 py-2 font-medium">
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {stint.laps.map((lap) => (
              <tr
                key={`${lap.run}-${lap.lap}`}
                className={`border-t border-border ${isHighlighted?.(lap.lapSeconds) ? 'bg-accent font-semibold' : ''}`}
              >
                <td className="px-3 py-2">{lap.lap}</td>
                <td className="px-3 py-2">{formatSeconds(lap.lapSeconds)}</td>
                <td className="px-3 py-2">
                  {new Date(lap.startedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}
                </td>
                <td className="px-3 py-2">{lap.clean ? 'Yes' : 'No'}</td>
                <td className="px-3 py-2">{formatTempF(lap.trackTempC)}</td>
                <td className="px-3 py-2">{formatTempF(lap.airTempC)}</td>
                <td className="px-3 py-2">{Math.round(lap.relativeHumidity * 100)}%</td>
                <td className="px-3 py-2">{formatWind(lap.windVelocity, lap.windDirection)}</td>
                <td className="px-3 py-2">{formatClouds(lap.cloudCover)}</td>
                <td className="px-3 py-2">{formatPressure(lap.airPressure)}</td>
                {showWetness && (
                  <>
                    <td className="px-3 py-2">{Math.round(lap.precipitation * 100)}%</td>
                    <td className="px-3 py-2">{lap.trackWetness}</td>
                  </>
                )}
                <td className="px-3 py-2">{lap.trackUsage}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
