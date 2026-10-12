'use client';

import type { ReactNode } from 'react';

import { useLanguage } from '@/components/LanguageProvider';
import {
  formatClouds,
  formatPressure,
  formatSeconds,
  formatWind,
  type StintExport,
} from '@/lib/stintExport';
import { formatTemperature } from '@/lib/units';
import { useUnits } from '@/components/UnitsProvider';

type WeatherTableProps = {
  stint: StintExport;
  onRemove: () => void;
  note?: string;
  isHighlighted?: (lapSeconds: number) => boolean;
  showWetness?: boolean; // the Precip. and Wetness columns
  summary?: ReactNode; // shown between the heading and the table
};

const WETNESS_HEADINGS = ['precip', 'wetness'] as const;
const HEADINGS = [
  'lap', 'lapTime', 'started', 'clean', 'trackTemp', 'airTemp', 'humidity', 'wind', 'clouds',
  'pressure', ...WETNESS_HEADINGS, 'trackUsage',
] as const;

// Per-lap weather from a Garage 61 stint export
export default function WeatherTable({ stint, onRemove, note, isHighlighted, showWetness = true, summary }: WeatherTableProps) {
  const { t, fmt, locale } = useLanguage();
  const units = useUnits();
  const formatTempIn = (celsius: number) => formatTemperature(celsius, units);
  const headings = showWetness
    ? HEADINGS
    : HEADINGS.filter((h) => !(WETNESS_HEADINGS as readonly string[]).includes(h));
  const trackTemps = stint.laps.map((lap) => lap.trackTempC);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-medium text-foreground">
          {t.weather.title} <span className="font-normal text-muted-foreground">({stint.fileName})</span>
        </p>
        <button
          type="button"
          onClick={onRemove}
          aria-label={t.weather.remove}
          className="ml-3 text-muted-foreground hover:text-primary"
        >
          ✕
        </button>
      </div>
      <p className="text-sm text-muted-foreground mb-2">
        {fmt(t.weather.trackTempRange, { min: formatTempIn(Math.min(...trackTemps)), max: formatTempIn(Math.max(...trackTemps)) })}
        {note && ` ${note}`}
      </p>
      {summary}
      <div className="overflow-x-auto bg-card border border-border rounded-lg">
        <table className="w-full text-sm text-foreground whitespace-nowrap">
          <thead className="bg-secondary text-left text-muted-foreground">
            <tr>
              {headings.map((heading) => (
                <th key={heading} className="px-3 py-2 font-medium">
                  {t.weather.headings[heading]}
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
                  {new Date(lap.startedAt).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit', second: '2-digit' })}
                </td>
                <td className="px-3 py-2">{lap.clean ? t.common.yes : t.common.no}</td>
                <td className="px-3 py-2">{formatTempIn(lap.trackTempC)}</td>
                <td className="px-3 py-2">{formatTempIn(lap.airTempC)}</td>
                <td className="px-3 py-2">{Math.round(lap.relativeHumidity * 100)}%</td>
                <td className="px-3 py-2">{formatWind(lap.windVelocity, lap.windDirection, units, t.weather.compass)}</td>
                <td className="px-3 py-2">{formatClouds(lap.cloudCover, t.weather.clouds)}</td>
                <td className="px-3 py-2">{formatPressure(lap.airPressure, units)}</td>
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
