'use client';

import { Droplets, Layers, Thermometer, ThermometerSun, Wind, type LucideIcon } from 'lucide-react';
import { useLanguage } from '@/components/LanguageProvider';
import { useUnits } from '@/components/UnitsProvider';
import type { LapConditions } from '@/lib/collectorLaps';
import { formatWind } from '@/lib/stintExport';
import { formatTemperature } from '@/lib/units';

// The weather a recorded session ended in (its last lap's, see LapConditions), shown under the session's heading
// in Debrief Coach's recorded laps: track and air temperature, humidity, wind and track usage, each with an icon.
// Conditions iRacing didn't give are left out.
export default function SessionConditions({ conditions }: { conditions: LapConditions }) {
  const { t } = useLanguage();
  const units = useUnits();
  const headings = t.weather.headings;
  const c = conditions;
  // iRacing's words for the track's rubber, in the user's language when they're ones we know
  const usage = c.trackUsage && (t.weather.trackUsageStates[c.trackUsage.toLowerCase()] ?? c.trackUsage);

  const items: { icon: LucideIcon; label: string; value: string }[] = [];
  if (c.trackTempC !== null) items.push({ icon: ThermometerSun, label: headings.trackTemp, value: formatTemperature(c.trackTempC, units) });
  if (c.airTempC !== null) items.push({ icon: Thermometer, label: headings.airTemp, value: formatTemperature(c.airTempC, units) });
  if (c.relativeHumidity !== null) {
    items.push({ icon: Droplets, label: headings.humidity, value: `${Math.round(c.relativeHumidity * 100)}%` });
  }
  if (c.windVelocity !== null && c.windDirection !== null) {
    items.push({ icon: Wind, label: headings.wind, value: formatWind(c.windVelocity, c.windDirection, units, t.weather.compass) });
  }
  if (usage) items.push({ icon: Layers, label: headings.trackUsage, value: usage });
  if (items.length === 0) return null;

  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-xs text-muted-foreground">
      <span className="sr-only">{t.recordedLaps.endConditions}</span>
      {items.map(({ icon: Icon, label, value }) => (
        <span key={label} className="inline-flex items-center gap-1" title={`${label}: ${value}`}>
          <Icon className="w-3.5 h-3.5 text-primary" aria-hidden />
          <span className="sr-only">{label}:</span>
          <span className="text-foreground">{value}</span>
        </span>
      ))}
    </span>
  );
}
