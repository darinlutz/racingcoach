'use client';

import { type ReactNode } from 'react';

import { useLanguage } from '@/components/LanguageProvider';
import { useTelemetry, type ChartSettings } from '@/components/TelemetryCursor';

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`flex items-center gap-1.5 rounded border px-2 py-1 font-display text-[11px] font-semibold uppercase tracking-[0.1em] transition-colors ${
        on ? 'border-primary/60 bg-secondary text-foreground' : 'border-border text-muted-foreground hover:text-foreground'
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${on ? 'bg-tele-pos' : 'bg-border'}`} />
      {children}
    </button>
  );
}

const ACTION = 'rounded border border-border px-2 py-1 font-display text-[11px] font-semibold uppercase tracking-[0.1em] hover:bg-secondary';

// Above the telemetry charts: which laps they show and what's drawn on them, and Zoom to turn and Reset zoom. The
// charts follow the user's Preferred Units, so there's no unit switch here. It doesn't change the map or 3D view.
export default function ChartToolbar() {
  const { t } = useLanguage();
  const labels = t.charts.telemetry;
  const { settings, setSetting, zoomToTurn, resetZoom, zoomed } = useTelemetry();
  const flip = (key: Exclude<keyof ChartSettings, 'speedMode'>) => setSetting(key, !settings[key]);
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1.5">
      <Toggle on={settings.showTarget} onClick={() => flip('showTarget')}>
        <i className="inline-block h-0.5 w-3 bg-lap-target" />
        {labels.target}
      </Toggle>
      <Toggle on={settings.showCompare} onClick={() => flip('showCompare')}>
        <i className="inline-block h-0.5 w-3 bg-lap-compare" />
        {labels.compare}
      </Toggle>
      <span className="mx-1 h-5 w-px bg-border" />
      <Toggle on={settings.deltaOverlay} onClick={() => flip('deltaOverlay')}>{labels.deltaOverlay}</Toggle>
      <Toggle on={settings.showEvents} onClick={() => flip('showEvents')}>{labels.events}</Toggle>
      <Toggle on={settings.showDiff} onClick={() => flip('showDiff')}>{labels.diffShading}</Toggle>
      <Toggle on={settings.showGrid} onClick={() => flip('showGrid')}>{labels.grid}</Toggle>
      <Toggle on={settings.showCursor} onClick={() => flip('showCursor')}>{labels.cursor}</Toggle>
      <span className="ml-auto flex items-center gap-1.5">
        <button type="button" onClick={zoomToTurn} className={`${ACTION} text-foreground`}>
          {labels.zoomToTurn}
        </button>
        <button type="button" onClick={resetZoom} disabled={!zoomed} className={`${ACTION} text-muted-foreground enabled:hover:text-foreground disabled:opacity-50`}>
          {labels.resetZoom}
        </button>
      </span>
    </div>
  );
}
