'use client';

import { useLanguage } from '@/components/LanguageProvider';
import { signedValue } from '@/components/TelemetryChart';
import { useTelemetry } from '@/components/TelemetryCursor';
import { steeringLabel } from '@/components/SteeringTrace';

// Both laps' pedals, steering and speed at the crosshair, and Compare minus Target, in the user's units
export default function CursorValuesTable() {
  const { t, locale } = useLanguage();
  const labels = t.charts.telemetry;
  const { grid, cursorIndex } = useTelemetry();
  const pair = ([target, other]: [number[], number[]]) => (cursorIndex === null ? [NaN, NaN] : [target[cursorIndex], other[cursorIndex]]);
  const row = (key: string, label: string, values: [number[], number[]], show: (value: number) => string, delta: (value: number) => string) => {
    const [target, other] = pair(values);
    const known = Number.isFinite(target) && Number.isFinite(other);
    return { key, label, target: Number.isFinite(target) ? show(target) : '–', other: Number.isFinite(other) ? show(other) : '–', delta: known ? delta(other - target) : '–' };
  };
  // Rounded as shown, so the differences match the two values beside them
  const wholeDelta = (values: [number[], number[]]) => {
    const [target, other] = pair(values);
    return Math.round(other) - Math.round(target);
  };
  const percent = (value: number) => `${value.toFixed(0)}%`;
  const points = (values: [number[], number[]]) => () => `${signedValue(wholeDelta(values), locale)} ${labels.percentPoints}`;
  const rows = [
    row('throttle', t.charts.throttle, grid.throttles, percent, points(grid.throttles)),
    row('brake', t.charts.brake, grid.brakes, percent, points(grid.brakes)),
    row('steering', labels.steer, grid.steerings, (right) => steeringLabel(-right, t.charts), () => `${signedValue(wholeDelta(grid.steerings), locale)}°`),
    row('speed', labels.speed, grid.speeds, (speed) => Math.round(speed).toLocaleString(locale), (value) => signedValue(value, locale, 1)),
  ];
  return (
    <div className="rounded-md border border-border bg-card">
      <div className="tele-label grid grid-cols-4 border-b border-border px-3 py-1.5">
        <span>{labels.atCursor}</span>
        <span className="text-right text-lap-target">{labels.target}</span>
        <span className="text-right text-lap-compare">{labels.compare}</span>
        <span className="text-right">Δ</span>
      </div>
      {rows.map(({ key, label, target, other, delta }) => (
        <div key={key} className="tele-num grid grid-cols-4 px-3 py-1 text-xs">
          <span className="font-sans text-muted-foreground">{label}</span>
          <span className="text-right text-lap-target">{target}</span>
          <span className="text-right text-lap-compare">{other}</span>
          <span className="text-right text-foreground">{delta}</span>
        </div>
      ))}
    </div>
  );
}
