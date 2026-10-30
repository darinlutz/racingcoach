'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';

import { useLanguage } from '@/components/LanguageProvider';
import type { PedalTraceLap } from '@/components/PedalTraces';
import { useUnits } from '@/components/UnitsProvider';
import { lineOffsets } from '@/lib/areaInputs';
import { carBalance, tireSlipAngles } from '@/lib/lapChannels';
import { clamp, type Axis } from '@/lib/lapCharts';
import { timeAtPosition, TIRE_CORNERS, type TireCorner } from '@/lib/lapData';
import { cornerPhases, detectLapEvents, evenGrid, positionAtTime, resample, resampleNearest, type CornerPhase, type LapEvents } from '@/lib/lapEvents';
import { DISTANCE_UNIT, distanceFromFeet, distanceFromMeters, speedFromMetersPerSecond } from '@/lib/units';

// Enough points for the charts' lines to stay sharp when zoomed in, and few enough to draw at once
const GRID_POINTS = 1000;
// The closest the charts zoom in, and the space Zoom to turn leaves around the corner (feet), or shares of
// the focus area without a track length
const MIN_SPAN_FEET = 120;
const MIN_SPAN_SHARE = 0.1;
const TURN_MARGIN_FEET = 60;
const TURN_MARGIN_SHARE = 0.03;
const WHEEL_ZOOM = 1.15;
const EPSILON = 1e-9;

// The toolbar's switches, and the Speed chart's mode; kept by Lap Compare across focus areas
export type ChartSettings = {
  showTarget: boolean;
  showCompare: boolean;
  deltaOverlay: boolean;
  showEvents: boolean;
  showDiff: boolean;
  showGrid: boolean;
  showCursor: boolean;
  speedMode: 'overlay' | 'delta';
};

export const DEFAULT_CHART_SETTINGS: ChartSettings = {
  showTarget: true,
  showCompare: true,
  deltaOverlay: false,
  showEvents: true,
  showDiff: true,
  showGrid: true,
  showCursor: true,
  speedMode: 'delta',
};

// Both laps on one grid of lap positions, as they're shown: [Target, Compare], pedals in %, steering in degrees
// with right positive (iRacing's is left positive), speed in the user's units. timeDeltas is the Compare lap's
// seconds behind (+) the Target lap since the start of the area, and lineOffsets how far it was left (+) of the
// Target lap's line in feet or meters, null without track positions.
export type LapGrid = {
  pcts: number[];
  throttles: [number[], number[]];
  brakes: [number[], number[]];
  steerings: [number[], number[]];
  speeds: [number[], number[]];
  timeDeltas: number[];
  lineOffsets: number[] | null;
};

// One channel of both laps on the grid: [Target, Compare], null for a lap whose file doesn't have it
export type ChannelPair = [number[] | null, number[] | null];

// What the bottom tabs' dashboards show, on the same grid, in the lap files' units but for the handling channels:
// yaw rate (°/s) and slip angles (°) with right positive like the steering, rear wheel slip in %, balance in degrees
// with understeer positive. Pressures kPa, ride heights meters, temperatures °C, fuel kg and kg/h.
export type LapChannels = {
  yawRates: ChannelPair;
  frontSlips: ChannelPair;
  rearSlips: ChannelPair;
  rearWheelSlips: ChannelPair;
  balances: ChannelPair;
  gears: ChannelPair;
  rpms: ChannelPair;
  waterTemps: ChannelPair;
  oilTemps: ChannelPair;
  fuelKgs: ChannelPair;
  fuelKgPerHour: ChannelPair;
  tirePressures: Record<TireCorner, ChannelPair>;
  rideHeights: Record<TireCorner, ChannelPair>;
};

const present = (values: number[] | null | undefined) => (values?.some(Number.isFinite) ? values : null);

function lapChannels(base: PedalTraceLap, compare: PedalTraceLap, pcts: number[]): LapChannels {
  const laps = [base, compare];
  const pair = (values: (lap: PedalTraceLap) => number[] | null | undefined, convert: (value: number) => number = (value) => value, nearest = false): ChannelPair => {
    const [a, b] = laps.map((lap) => {
      const raw = present(values(lap));
      return raw ? (nearest ? resampleNearest : resample)(lap.trace.pcts, raw, pcts).map(convert) : null;
    });
    return [a, b];
  };
  const byCorner = (values: (lap: PedalTraceLap, corner: TireCorner) => number[] | null | undefined) =>
    Object.fromEntries(TIRE_CORNERS.map((corner) => [corner, pair((lap) => values(lap, corner))])) as Record<TireCorner, ChannelPair>;
  const negate = (value: number) => -value;
  return {
    yawRates: pair((lap) => lap.trace.handling.yawRates, (radians) => -degrees(radians)),
    frontSlips: pair((lap) => tireSlipAngles(lap.trace).front, negate),
    rearSlips: pair((lap) => tireSlipAngles(lap.trace).rear, negate),
    rearWheelSlips: pair((lap) => lap.trace.handling.rearWheelSlips, (ratio) => ratio * 100),
    balances: pair((lap) => carBalance(lap.trace)),
    gears: pair((lap) => lap.trace.engine.gears, undefined, true),
    rpms: pair((lap) => lap.trace.engine.rpms),
    waterTemps: pair((lap) => lap.trace.engine.waterTemps),
    oilTemps: pair((lap) => lap.trace.engine.oilTemps),
    fuelKgs: pair((lap) => lap.trace.engine.fuelKgs),
    fuelKgPerHour: pair((lap) => lap.trace.engine.fuelKgPerHour),
    tirePressures: byCorner((lap, corner) => lap.trace.tirePressures?.[corner]),
    rideHeights: byCorner((lap, corner) => lap.trace.rideHeights?.[corner]),
  };
}

type TelemetryValue = {
  base: PedalTraceLap;
  compare: PedalTraceLap;
  grid: LapGrid;
  channels: LapChannels;
  events: { target: LapEvents; compare: LapEvents };
  phases: CornerPhase[];
  // The whole focus area, and what the charts show of it now
  fullAxis: Axis;
  axis: Axis;
  zoomed: boolean;
  zoomAt: (center: number, factor: number) => void;
  pan: (deltaPct: number) => void;
  zoomToTurn: () => void;
  resetZoom: () => void;
  canZoom: (factor: number) => boolean;
  // The crosshair the charts and the map share, null when there's none
  cursorPct: number | null;
  cursorIndex: number | null;
  // What pointing at a chart does: nothing while the cursor is locked or playing
  hoverFromChart: (pct: number | null) => void;
  // What the map and the 3D view do: always moves the crosshair, as their own Play needs it to
  hoverFromMap: (pct: number | null) => void;
  moveCursor: (pct: number) => void;
  locked: boolean;
  setLocked: (locked: boolean) => void;
  clickAt: (pct: number) => void;
  playing: boolean;
  setPlaying: (playing: boolean) => void;
  playRate: number;
  setPlayRate: (rate: number) => void;
  settings: ChartSettings;
  setSetting: <K extends keyof ChartSettings>(key: K, value: ChartSettings[K]) => void;
};

const TelemetryContext = createContext<TelemetryValue | null>(null);

export function useTelemetry() {
  const value = useContext(TelemetryContext);
  if (!value) throw new Error('useTelemetry must be used inside <TelemetryCursor>');
  return value;
}

const degrees = (radians: number) => (radians * 180) / Math.PI;

function lapGrid(base: PedalTraceLap, compare: PedalTraceLap, units: ReturnType<typeof useUnits>): LapGrid {
  const pcts = evenGrid(base.trace.domain, GRID_POINTS);
  const onGrid = (lap: PedalTraceLap, values: number[]) => resample(lap.trace.pcts, values, pcts);
  const both = (values: (lap: PedalTraceLap) => number[], convert: (value: number) => number): [number[], number[]] => [
    onGrid(base, values(base)).map(convert),
    onGrid(compare, values(compare)).map(convert),
  ];
  const [baseStart, compareStart] = [timeAtPosition(base.trace, pcts[0]), timeAtPosition(compare.trace, pcts[0])];
  const offsetAt = lineOffsets(compare.trace, base.trace);
  const [from, to] = base.trace.domain;
  return {
    pcts,
    throttles: both((lap) => lap.trace.throttles, (value) => value * 100),
    brakes: both((lap) => lap.trace.brakes, (value) => value * 100),
    steerings: both((lap) => lap.trace.steerings, (radians) => -degrees(radians)),
    speeds: both((lap) => lap.trace.speeds, (speed) => speedFromMetersPerSecond(speed, units)),
    timeDeltas: pcts.map((pct) => timeAtPosition(compare.trace, pct) - compareStart - (timeAtPosition(base.trace, pct) - baseStart)),
    lineOffsets: offsetAt && pcts.map((pct) => distanceFromMeters(offsetAt(clamp((pct - from) / (to - from), 0, 1)), units)),
  };
}

// Holds what Lap Compare's telemetry charts share through a focus area: the crosshair, whether it's locked, the
// zoomed part of the area, playback and the toolbar's settings. Mounted per focus area, so zoom starts over on the
// next one. The map and the 3D view get cursorPct and hoverFromMap as their hoverPct and onHover: a lock holds the
// crosshair for the charts, while pointing at the map or the 3D view's Play moves it for as long as they do.
export default function TelemetryCursor({
  base,
  compare,
  lengthFeet,
  settings,
  onSettingsChange,
  children,
}: {
  base: PedalTraceLap;
  compare: PedalTraceLap;
  lengthFeet: number | null;
  settings: ChartSettings;
  onSettingsChange: (settings: ChartSettings) => void;
  children: ReactNode;
}) {
  const { locale } = useLanguage();
  const units = useUnits();
  const fullDomain = base.trace.domain;
  const fullSpan = fullDomain[1] - fullDomain[0];
  const minSpan = Math.min(fullSpan, lengthFeet ? MIN_SPAN_FEET / lengthFeet : fullSpan * MIN_SPAN_SHARE);

  const grid = useMemo(() => lapGrid(base, compare, units), [base, compare, units]);
  const channels = useMemo(() => lapChannels(base, compare, grid.pcts), [base, compare, grid.pcts]);
  const events = useMemo(() => ({ target: detectLapEvents(base.trace), compare: detectLapEvents(compare.trace) }), [base, compare]);
  const phases = useMemo(() => cornerPhases(events.target, fullDomain[1]), [events, fullDomain]);

  const fullAxis = useMemo<Axis>(
    () => ({
      domain: fullDomain,
      length: lengthFeet ? distanceFromFeet(lengthFeet, units) : null,
      unit: DISTANCE_UNIT[units],
      locale,
    }),
    [fullDomain, lengthFeet, units, locale]
  );
  const [domain, setDomain] = useState<[number, number]>(fullDomain);
  const axis = useMemo<Axis>(() => ({ ...fullAxis, domain }), [fullAxis, domain]);

  const zoomAt = useCallback(
    (center: number, factor: number) =>
      setDomain(([d0, d1]) => {
        const span = clamp((d1 - d0) * factor, minSpan, fullSpan);
        const start = clamp(center - ((center - d0) / (d1 - d0)) * span, fullDomain[0], fullDomain[1] - span);
        return [start, start + span];
      }),
    [fullDomain, fullSpan, minSpan]
  );
  const pan = useCallback(
    (deltaPct: number) =>
      setDomain(([d0, d1]) => {
        const start = clamp(d0 + deltaPct, fullDomain[0], fullDomain[1] - (d1 - d0));
        return [start, start + (d1 - d0)];
      }),
    [fullDomain]
  );
  const span = domain[1] - domain[0];
  const canZoom = useCallback(
    (factor: number) => (factor < 1 ? span > minSpan + EPSILON : span < fullSpan - EPSILON),
    [span, minSpan, fullSpan]
  );
  const resetZoom = () => setDomain(fullDomain);
  // From the earlier brakepoint to the later full throttle of the two laps
  const zoomToTurn = () => {
    const margin = lengthFeet ? TURN_MARGIN_FEET / lengthFeet : fullSpan * TURN_MARGIN_SHARE;
    const known = (values: (number | null)[]) => values.filter((value): value is number => value !== null);
    const starts = known([events.target.brakePoint, events.compare.brakePoint]);
    const ends = known([events.target.fullThrottle, events.compare.fullThrottle]);
    const from = starts.length > 0 ? Math.min(...starts) - margin : fullDomain[0];
    const to = ends.length > 0 ? Math.max(...ends) + margin : fullDomain[1];
    const width = clamp(to - from, minSpan, fullSpan);
    const start = clamp(from, fullDomain[0], fullDomain[1] - width);
    setDomain([start, start + width]);
  };

  const [hoverPct, setHoverPct] = useState<number | null>(null);
  const [lockedPct, setLockedPct] = useState<number | null>(null);
  const [playing, setPlayingRaw] = useState(false);
  const [playRate, setPlayRate] = useState(1);
  const playFrom = useRef(fullDomain[0]);
  const locked = lockedPct !== null;
  const cursorPct = hoverPct ?? lockedPct;
  const cursorIndex =
    cursorPct === null ? null : clamp(Math.round(((cursorPct - fullDomain[0]) / fullSpan) * (GRID_POINTS - 1)), 0, GRID_POINTS - 1);

  const hoverFromChart = useCallback(
    (pct: number | null) => {
      if (!locked && !playing) setHoverPct(pct);
    },
    [locked, playing]
  );
  const moveCursor = (pct: number) => {
    const moved = clamp(pct, fullDomain[0], fullDomain[1]);
    playFrom.current = moved; // Playback carries on from where the slider or a step puts it
    if (locked) setLockedPct(moved);
    else setHoverPct(moved);
  };
  const setLocked = (lock: boolean) => {
    if (lock) {
      setLockedPct(cursorPct ?? domain[0]);
      setHoverPct(null);
    } else {
      setHoverPct(lockedPct);
      setLockedPct(null);
    }
  };
  const clickAt = (pct: number) => {
    if (locked) {
      setLockedPct(null);
      setHoverPct(pct);
    } else {
      setLockedPct(pct);
      setHoverPct(null);
    }
  };

  // Playback drives the crosshair through the shown part of the area at the Target lap's real pace, by its
  // sample times, and carries on from the start when it reaches the end
  const setPlaying = (play: boolean) => {
    if (play) {
      playFrom.current = cursorPct !== null && cursorPct >= domain[0] && cursorPct < domain[1] ? cursorPct : domain[0];
      setHoverPct(playFrom.current);
      setLockedPct(null);
    }
    setPlayingRaw(play);
  };
  useEffect(() => {
    if (!playing) return;
    const [d0, d1] = domain;
    let last = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      const seconds = timeAtPosition(base.trace, clamp(playFrom.current, d0, d1)) + ((now - last) / 1000) * playRate;
      last = now;
      let pct = positionAtTime(base.trace, seconds);
      if (pct >= d1) pct = d0;
      playFrom.current = pct;
      setHoverPct(pct);
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [playing, playRate, domain, base]);

  const value: TelemetryValue = {
    base,
    compare,
    grid,
    channels,
    events,
    phases,
    fullAxis,
    axis,
    zoomed: span < fullSpan - EPSILON,
    zoomAt,
    pan,
    zoomToTurn,
    resetZoom,
    canZoom,
    cursorPct,
    cursorIndex,
    hoverFromChart,
    hoverFromMap: setHoverPct,
    moveCursor,
    locked,
    setLocked,
    clickAt,
    playing,
    setPlaying,
    playRate,
    setPlayRate,
    settings,
    setSetting: (key, setting) => onSettingsChange({ ...settings, [key]: setting }),
  };
  return <TelemetryContext.Provider value={value}>{children}</TelemetryContext.Provider>;
}

// How a chart's plot answers the pointer, wheel and keyboard: spread svgProps on the <svg> and plotProps on a
// transparent <rect> over the plot. Pointing moves the crosshair, a click locks or frees it, the wheel zooms where
// it points (the page scrolls when there's no more to zoom), a drag pans when zoomed, and the arrow keys move the
// crosshair a hundredth of what's shown.
export function useChartPointer() {
  const { axis, zoomed, zoomAt, pan, canZoom, cursorPct, hoverFromChart, moveCursor, clickAt, locked, playing } = useTelemetry();
  const [d0, d1] = axis.domain;
  const span = d1 - d0;
  const plotRef = useRef<SVGRectElement>(null);
  const drag = useRef<{ x: number; start: number; moved: boolean } | null>(null);

  useEffect(() => {
    const plot = plotRef.current;
    if (!plot) return;
    const onWheel = (event: WheelEvent) => {
      const box = plot.getBoundingClientRect();
      if (!box.width) return;
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        if (!zoomed) return;
        event.preventDefault();
        pan((event.deltaX / box.width) * span);
        return;
      }
      const factor = event.deltaY > 0 ? WHEEL_ZOOM : 1 / WHEEL_ZOOM;
      if (!canZoom(factor)) return;
      event.preventDefault();
      zoomAt(d0 + ((event.clientX - box.left) / box.width) * span, factor);
    };
    plot.addEventListener('wheel', onWheel, { passive: false });
    return () => plot.removeEventListener('wheel', onWheel);
  }, [d0, span, zoomed, pan, canZoom, zoomAt]);

  const pctAt = (event: PointerEvent<SVGRectElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return box.width ? clamp(d0 + ((event.clientX - box.left) / box.width) * span, d0, d1) : d0;
  };

  const svgProps = {
    tabIndex: 0,
    onKeyDown: (event: KeyboardEvent<SVGSVGElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        clickAt(cursorPct ?? d0);
        return;
      }
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const step = (event.key === 'ArrowRight' ? 1 : -1) * (span / 100);
      moveCursor(clamp((cursorPct ?? d0) + step, d0, d1));
    },
    onFocus: () => {
      if (cursorPct === null) hoverFromChart(d0);
    },
    onBlur: () => hoverFromChart(null),
  };

  const plotProps = {
    ref: plotRef,
    fill: 'transparent',
    style: { touchAction: 'pan-y' as const, cursor: 'crosshair' },
    onPointerDown: (event: PointerEvent<SVGRectElement>) => {
      drag.current = { x: event.clientX, start: d0, moved: false };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove: (event: PointerEvent<SVGRectElement>) => {
      if (drag.current) {
        const dx = event.clientX - drag.current.x;
        if (Math.abs(dx) > 3) drag.current.moved = true;
        if (drag.current.moved) {
          const box = event.currentTarget.getBoundingClientRect();
          if (zoomed && box.width) pan(drag.current.start - (dx / box.width) * span - d0);
          return;
        }
      }
      hoverFromChart(pctAt(event));
    },
    onPointerUp: (event: PointerEvent<SVGRectElement>) => {
      const wasDrag = drag.current?.moved;
      drag.current = null;
      if (!wasDrag) clickAt(pctAt(event));
    },
    onPointerCancel: () => {
      drag.current = null;
    },
    onPointerLeave: () => {
      if (!drag.current && !locked && !playing) hoverFromChart(null);
    },
  };

  return { svgProps, plotProps };
}
