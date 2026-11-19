'use client';

import { EngineeringCarLayer } from '@/components/EngineeringCarView';
import { useLanguage } from '@/components/LanguageProvider';
import type { CarFit } from '@/lib/carViews/anchors';
import {
  bandsOnScreen,
  CORNERS,
  findItem,
  formatPressure,
  formatValuePressure,
  gaugeFraction,
  gaugeRange,
  heatFraction,
  percentChange,
  tempRange,
  tireKind,
  toKpa,
  treadTemps,
  visibleKinds,
  type Corner,
  type TireDrawingProps,
} from '@/lib/tiresGeometry';

// The gauges' centers: a schematic layout around the car, outboard of its wheels, the car's left on the left
const AT: Record<Corner, [number, number]> = { LF: [259, 155], RF: [501, 155], LR: [259, 367], RR: [501, 367] };
const TIRES_FIT: CarFit = { kind: 'axles', centerX: 380, frontY: 155, rearY: 367 };

// The Tires tab's top view of the car (from the Lovable design): each tire with a gauge ring per setup showing its
// starting pressure on a scale of all of them, the last run's tread temperatures as three heat bands across it (on a
// scale relative to the readings shown), grooves on a wet tire, and beside it both pressures, the delta and the change.
// Click or press Enter on a tire to select it
export default function TireFourCornerOverview(props: TireDrawingProps) {
  const { t, fmt } = useLanguage();
  const s = t.setups.tires;
  const { comparison, mode, selected, onSelect, unit } = props;
  const range = gaugeRange(comparison);
  const heat = tempRange(comparison);
  const kinds = visibleKinds(mode);
  const type = findItem(comparison, 'car', 'type');
  const arc = (r: number) => `M${-r * 0.707} ${r * 0.707} A${r} ${r} 0 1 1 ${r * 0.707} ${r * 0.707}`;
  return (
    <svg viewBox="0 0 760 515" className="align-svg h-auto w-full" role="group" aria-label={s.overviewAria}>
      <path d="M380 24 V471 M270 153 H490 M270 370 H490" className="align-reference" />
      {/* The compared setups' car from above, its axles on the gauges' rows (EngineeringCarView.tsx). Its own wheels are
          hidden: the gauges beside it are the tires, set outboard of the car so their rings and values fit */}
      <EngineeringCarLayer view="top" fit={TIRES_FIT} showWheels={false} />
      <text x="380" y="39" textAnchor="middle">
        {s.front.toUpperCase()}
      </text>
      <text x="380" y="485" textAnchor="middle">
        {s.sides.toUpperCase()}
      </text>
      {CORNERS.map((corner, i) => {
        const [x, y] = AT[corner];
        const left = i % 2 === 0;
        const tx = left ? 24 : 593;
        const item = findItem(comparison, corner, 'startPressure');
        const temps = findItem(comparison, corner, 'temps');
        const pct = percentChange(item?.baseline ?? null, item?.comparison ?? null);
        const shownTemps = treadTemps(temps, mode === 'comparison' ? 'comparison' : 'baseline') ?? treadTemps(temps, 'comparison');
        return (
          <g key={corner}>
            <g
              transform={`translate(${x} ${y})`}
              role="button"
              tabIndex={0}
              aria-label={fmt(s.selectTire, { corner: s.corners[corner] })}
              aria-pressed={selected === corner}
              className="align-wheel"
              onClick={() => onSelect(corner)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect(corner);
                }
              }}
            >
              <rect x="-62" y="-80" width="124" height="158" rx="8" className="align-ring" />
              <rect x="-27" y="-47" width="54" height="94" rx="14" className="tire-rubber-plain" />
              {/* The last run's tread temperatures, three bands across the tread */}
              {shownTemps &&
                bandsOnScreen(shownTemps, corner).map((v, b) => (
                  <rect key={b} x={-24 + b * 16} y="-43" width="16" height="86" rx="4" className="tire-heat" style={{ fill: `var(--tire-heat-${Math.round(heatFraction(v, heat) * 4)})` }} />
                ))}
              <path d="M-21 -35 V35 M21 -35 V35 M-15 -39 Q0 -46 15 -39 M-15 39 Q0 46 15 39" className="align-structure" />
              <rect x="-11" y="-31" width="22" height="62" rx="5" className="tire-rim" />
              {kinds.map((kind, j) => {
                const f = gaugeFraction(toKpa(item?.[kind] ?? null), range);
                return (
                  <g key={kind} className={kind === 'baseline' ? 'align-baseline' : 'align-comparison'}>
                    <path d={arc(j ? 66 : 58)} className="tire-gauge-track" />
                    {f != null && <path d={arc(j ? 66 : 58)} pathLength={100} strokeDasharray={`${f * 100} 100`} className="tire-gauge-arc" />}
                    {tireKind(type, kind) === 'wet' && (
                      <path d={`M${-23 + j * 4} -30 l8 8 -8 8 8 8 -8 8 8 8 M${23 - j * 4} -30 l-8 8 8 8 -8 8 8 8 -8 8`} strokeWidth="1.2" />
                    )}
                  </g>
                );
              })}
              <circle cx="15" cy="28" r="2.5" className="tire-valve" />
              <text y="-88" textAnchor="middle" className="align-wheel-label">
                {corner}
              </text>
            </g>
            <path d={`M${left ? tx + 141 : tx - 9} ${y - 27} H${left ? x - 72 : x + 72}`} className="align-reference" />
            <text x={tx} y={y - 50} className="align-wheel-label">
              {s.corners[corner].toUpperCase()}
            </text>
            {kinds.map((kind, j) => (
              <text key={kind} x={tx} y={y - 26 + j * 20} className={`align-value ${kind === 'baseline' ? 'text-align-baseline' : 'text-align-comparison'}`}>
                {kind === 'baseline' ? s.baselineShort : s.comparisonShort} · {formatValuePressure(item?.[kind] ?? null, unit)}
              </text>
            ))}
            <text x={tx} y={y + 25} className={item?.status === 'same' ? '' : 'align-value text-foreground'}>
              Δ {formatPressure(item?.deltaKpa ?? null, unit, { signed: true })}
            </text>
            <text x={tx} y={y + 43}>
              {pct == null ? '—' : `${pct > 0 ? '+' : pct < 0 ? '−' : '±'}${Math.abs(pct).toFixed(1)}%`}
            </text>
          </g>
        );
      })}
      <text x="380" y="505" textAnchor="middle">
        {range ? fmt(s.gaugeRange, { min: formatPressure(range.min, unit), max: formatPressure(range.max, unit) }).toUpperCase() : s.noGauge.toUpperCase()}
      </text>
    </svg>
  );
}
