'use client';

import { useId } from 'react';
import AlignmentDataPanel from '@/components/AlignmentDataPanel';
import AlignmentWheel from '@/components/AlignmentWheel';
import { useLanguage } from '@/components/LanguageProvider';
import { CORNERS, findItem, formatAlignment, isLeft, toeLayers, type AlignmentComparison, type Corner, type DisplayMode } from '@/lib/alignmentGeometry';

export type AlignmentDiagramProps = {
  comparison: AlignmentComparison;
  mode: DisplayMode;
  exaggeration: number;
  selected: Corner;
  onSelect: (corner: Corner) => void;
};

// Wheel centers in the plan drawing (viewBox 0 0 400 520): the nose up, the car's left on the left
const AT: Record<Corner, [number, number]> = { LF: [118, 150], RF: [282, 150], LR: [118, 395], RR: [282, 395] };

// The top view: a GT3-style chassis, its axles and centerline, and each wheel turned by its toe for each setup, with
// the four corners' values around it (beside the drawing on wide screens, under it on narrow ones)
export default function TopDownToeDiagram(props: AlignmentDiagramProps) {
  const { t, fmt } = useLanguage();
  const a = t.setups.alignment;
  const id = useId().replace(/:/g, '');
  const { comparison } = props;
  const frontTotal = findItem(comparison, 'front', 'totalToe');
  const rearTotal = findItem(comparison, 'rear', 'totalToe');
  const panel = (corner: Corner, place: string) => (
    <div className={place}>
      <AlignmentDataPanel comparison={comparison} scope={corner} selected={props.selected === corner} onSelect={() => props.onSelect(corner)} />
    </div>
  );
  return (
    <section className="align-grid relative min-w-0 rounded-lg border border-border" aria-labelledby={`${id}-title`}>
      <div className="flex items-center justify-between gap-2 px-4 pt-3">
        <h4 id={`${id}-title`} className="font-mono text-[11px] font-semibold uppercase tracking-widest text-foreground">
          {a.topView}
        </h4>
      </div>
      {(frontTotal || rearTotal) && (
        <div className="mx-4 mt-2 grid gap-2 sm:grid-cols-2">
          {frontTotal && <AlignmentDataPanel comparison={comparison} scope="front" />}
          {rearTotal && <AlignmentDataPanel comparison={comparison} scope="rear" />}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2 p-3 md:grid-cols-[minmax(0,10.5rem)_minmax(0,1fr)_minmax(0,10.5rem)] md:grid-rows-2 md:items-center">
        <div className="col-span-2 md:col-span-1 md:col-start-2 md:row-span-2 md:row-start-1">
          <svg viewBox="0 0 400 520" className="align-svg mx-auto block h-auto w-full max-w-[26rem]" role="img" aria-label={a.topView}>
            <defs>
              <pattern id={`${id}-hatch`} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(40)">
                <line x1="0" y1="0" x2="0" y2="5" className="align-structure" opacity="0.5" />
              </pattern>
            </defs>
            {/* The longitudinal centerline, the direction of travel and the axles */}
            <line x1="200" y1="40" x2="200" y2="492" className="align-reference" />
            <path d="M200 28 V52 M194 36 L200 28 L206 36" className="align-structure" />
            <text x="212" y="38">
              {a.forward.toUpperCase()}
            </text>
            <text x="206" y="500">
              {a.centerline.toUpperCase()}
            </text>
            <line x1="60" y1="150" x2="340" y2="150" className="align-reference" />
            <line x1="60" y1="395" x2="340" y2="395" className="align-reference" />
            <Chassis hatch={`url(#${id}-hatch)`} />
            {CORNERS.map((corner) => {
              const layers = toeLayers(comparison, corner, props.mode, props.exaggeration);
              const item = findItem(comparison, corner, 'toe');
              return (
                <AlignmentWheel
                  key={corner}
                  x={AT[corner][0]}
                  y={AT[corner][1]}
                  variant="plan"
                  layers={layers}
                  selected={props.selected === corner}
                  onSelect={() => props.onSelect(corner)}
                  name={fmt(a.selectWheel, { corner: a.corners[corner] })}
                  tooltip={fmt(a.wheelTooltip, {
                    corner: `${a.corners[corner]} · ${a.params.toe}`,
                    baseline: formatAlignment(item?.baseline ?? null, true),
                    comparison: formatAlignment(item?.comparison ?? null, true),
                  })}
                  labelSide={isLeft(corner) ? 'left' : 'right'}
                  shortName={a.cornerShort[corner]}
                  noDataText={a.noData.toUpperCase()}
                />
              );
            })}
          </svg>
        </div>
        {panel('LF', 'md:col-start-1 md:row-start-1')}
        {panel('RF', 'md:col-start-3 md:row-start-1')}
        {panel('LR', 'md:col-start-1 md:row-start-2')}
        {panel('RR', 'md:col-start-3 md:row-start-2')}
      </div>
    </section>
  );
}

// A GT3-style car from above, nose up, wheels at AT: splitter, body, cockpit, engine cover, wing
function Chassis({ hatch }: { hatch: string }) {
  return (
    <g aria-hidden>
      {/* Suspension arms to each wheel */}
      <path d="M132 140 L168 160 M132 160 L168 142 M268 140 L232 160 M268 160 L232 142 M132 385 L165 406 M132 406 L165 385 M268 385 L235 406 M268 406 L235 385" className="align-structure" />
      <line x1="132" y1="150" x2="268" y2="150" className="align-structure" />
      <line x1="132" y1="395" x2="268" y2="395" className="align-structure" />
      {/* Body */}
      <path
        d="M154 76 Q200 64 246 76 L262 112 L258 172 L248 200 L248 340 L262 372 L262 438 Q200 456 138 438 L138 372 L152 340 L152 200 L142 172 L138 112 Z"
        className="align-chassis"
      />
      {/* Splitter and nose */}
      <path d="M148 72 Q200 58 252 72 L256 80 Q200 68 144 80 Z" className="align-structure" />
      <path d="M160 86 Q200 77 240 86 L247 108 L153 108 Z M156 118 L244 118 L240 140 L160 140 Z" className="align-structure" />
      {/* Cockpit and glass */}
      <path d="M158 192 Q200 176 242 192 L234 228 L166 228 Z M166 230 L234 230 L238 318 L162 318 Z M162 321 L238 321 L246 352 L154 352 Z" className="align-structure" />
      <path d="M170 238 L230 238 L230 308 L170 308 Z M174 242 L226 304 M226 242 L174 304" className="align-structure" opacity="0.45" />
      {/* Side intakes and the engine cover */}
      <path d="M152 204 L152 334 M248 204 L248 334 M146 366 L254 366 M146 424 L254 424" className="align-structure" />
      <path d="M146 374 L254 374 L251 414 L149 414 Z" fill={hatch} className="align-structure" opacity="0.6" />
      {/* Rear wing */}
      <path d="M130 444 L270 444 L270 454 L130 454 Z" className="align-chassis" />
      <path d="M150 454 L150 462 M250 454 L250 462" className="align-structure" />
    </g>
  );
}
