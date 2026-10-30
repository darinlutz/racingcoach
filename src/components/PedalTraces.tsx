'use client';

import { useEffect, useRef, useState } from 'react';

import BrakeTrace from '@/components/BrakeTrace';
import ChartToolbar from '@/components/ChartToolbar';
import CornerPhaseIndicator from '@/components/CornerPhaseIndicator';
import CursorValuesTable from '@/components/CursorValuesTable';
import DrivingLineDiffTrace from '@/components/DrivingLineDiffTrace';
import DrivingLineMap from '@/components/DrivingLineMap';
import EngineeringInsightsPanel from '@/components/EngineeringInsightsPanel';
import LapComparisonHeader from '@/components/LapComparisonHeader';
import LapDataTabs, { type Tab as LapDataTab } from '@/components/LapDataTabs';
import { useLanguage } from '@/components/LanguageProvider';
import PlaybackControls from '@/components/PlaybackControls';
import SpeedTrace from '@/components/SpeedTrace';
import SteeringTrace from '@/components/SteeringTrace';
import SteeringWheel from '@/components/SteeringWheel';
import TelemetryCursor, { useTelemetry, type ChartSettings } from '@/components/TelemetryCursor';
import ThrottleTrace from '@/components/ThrottleTrace';
import TimeDeltaTrace from '@/components/TimeDeltaTrace';
import type { AreaTrace, LapSamples } from '@/lib/lapData';

const SIDE_BY_SIDE_MIN_WIDTH = 768; // narrower containers stack the charts in one column
const ROW_GAP = 16; // gap-4
const MAP_ASPECT = 0.69; //the map's height as a share of its width

export type PedalTraceLap = {
  title: string; // e.g. "Target lap · 1:25.488"
  lapTime: string; // e.g. "1:25.488"
  lapSeconds: number;
  trace: AreaTrace;
  summary: string; // text version of the chart, e.g. "Brakes at 812 ft (max 80%), throttle at 1,299 ft"
  samples: Pick<LapSamples, 'pcts' | 'tireTemps' | 'tireLayers' | 'sessionTimes' | 'engine'>; // the whole lap, for the Tire Temperature Comparison and the fuel a lap used
};

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

// Everything under the header and toolbar, which share the crosshair through TelemetryCursor. Two columns: on the
// left, the Target and Compare laps' driving lines on a map (DrivingLineMap: flat, or a 3D model built from the laps)
// with the crosshair's position marked on each, under it a steering wheel turned to both laps' angles at the
// crosshair, with their gears (SteeringWheel), then the values at the crosshair and what the laps measure differently.
// On the right, top to bottom: the corner's phases, the time the Compare lap gains or loses (TimeDeltaTrace), throttle
// and brake, steering angle, speed and how far left or right of the Target lap's line the Compare lap was, then playback.
// The columns stack when the container is narrower than SIDE_BY_SIDE_MIN_WIDTH.
// Last, the Balance, Tire Temp, Tire Pressure, Ride Heights, Gear and Engine tabs (LapDataTabs).
function TelemetryDashboard({
  id,
  areaName,
  width,
  dataTab,
  onDataTabChange,
}: {
  id: string;
  areaName: string;
  width: number;
  dataTab: LapDataTab;
  onDataTabChange: (tab: LapDataTab) => void;
}) {
  const { t } = useLanguage();
  const { base, compare, axis, fullAxis, cursorPct, hoverFromChart, hoverFromMap } = useTelemetry();
  const sideBySide = width >= SIDE_BY_SIDE_MIN_WIDTH;
  const half = sideBySide ? (width - ROW_GAP) / 2 : width;
  const column = sideBySide ? { width: half, flexShrink: 0 } : undefined;

  return (
    <>
      <LapComparisonHeader areaName={areaName} />
      <ChartToolbar />
      <div className={sideBySide ? 'flex items-start gap-4' : 'space-y-4'}>
        <div className="space-y-4" style={column}>
          <DrivingLineMap base={base} compare={compare} width={half} height={Math.round(half * MAP_ASPECT)} hoverPct={cursorPct} onHover={hoverFromMap} />
          <SteeringWheel base={base} compare={compare} axis={fullAxis} hoverPct={cursorPct} />
          <CursorValuesTable />
          <EngineeringInsightsPanel areaName={areaName} />
          <p className="px-1 text-[11px] leading-snug text-muted-foreground">{t.charts.telemetry.help}</p>
        </div>
        <div className="space-y-2" style={column}>
          <CornerPhaseIndicator id={`${id}-phases`} width={half} />
          <TimeDeltaTrace id={`${id}-delta`} width={half} />
          <ThrottleTrace id={`${id}-throttle`} width={half} />
          <BrakeTrace id={`${id}-brake`} width={half} />
          <SteeringTrace id={`${id}-steering`} width={half} />
          <SpeedTrace id={`${id}-speed`} width={half} />
          <DrivingLineDiffTrace id={`${id}-line`} width={half} />
          <PlaybackControls />
        </div>
      </div>
      <LapDataTabs id={`${id}-data`} base={base} compare={compare} axis={axis} fullAxis={fullAxis} width={width} hoverPct={cursorPct} onHover={hoverFromChart} tab={dataTab} onTabChange={onDataTabChange} />
    </>
  );
}

// Lap Compare's telemetry for one focus area, mounted per area. id must be unique on the page (the charts' clip paths
// are named after it). Charts only draw once the container has a width, so inside a closed <details> they draw when it's opened.
export default function PedalTraces({
  id,
  areaName,
  lengthFeet,
  base,
  compare,
  dataTab,
  onDataTabChange,
  chartSettings,
  onChartSettingsChange,
}: {
  id: string;
  areaName: string;
  lengthFeet: number | null;
  base: PedalTraceLap;
  compare: PedalTraceLap;
  // LapDataTabs' tab and the toolbar's settings, kept by Lap Compare across focus areas
  dataTab: LapDataTab;
  onDataTabChange: (tab: LapDataTab) => void;
  chartSettings: ChartSettings;
  onChartSettingsChange: (settings: ChartSettings) => void;
}) {
  const [containerRef, width] = useWidth();

  return (
    <div ref={containerRef} className="space-y-4">
      {width > 0 && (
        <TelemetryCursor base={base} compare={compare} lengthFeet={lengthFeet} settings={chartSettings} onSettingsChange={onChartSettingsChange}>
          <TelemetryDashboard id={id} areaName={areaName} width={width} dataTab={dataTab} onDataTabChange={onDataTabChange} />
        </TelemetryCursor>
      )}
    </div>
  );
}
