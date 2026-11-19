'use client';

import { useId } from 'react';
import AlignmentWheel from '@/components/AlignmentWheel';
import { EngineeringCarLayer } from '@/components/EngineeringCarView';
import { useLanguage } from '@/components/LanguageProvider';
import type { CarFit } from '@/lib/carViews/anchors';
import type { AlignmentDiagramProps } from '@/components/TopDownToeDiagram';
import { camberLayers, changeDirection, findItem, formatAlignment, viewCorners } from '@/lib/alignmentGeometry';

// The front or rear view (FrontCamberDiagram, RearCamberDiagram): the axle's two tires standing on the ground, each
// leaned by its camber for each setup, with vertical references, angle arcs and the values under the drawing.
// From the front the car's left is on the screen's right; from behind it's on the left (viewCorners)
const FIT: CarFit = { kind: 'ground', x: 70, width: 300, groundY: 168, maxHeight: 118 };

export default function AlignmentCamberDiagram({ view, ...props }: AlignmentDiagramProps & { view: 'front' | 'rear' }) {
  const { t, fmt } = useLanguage();
  const a = t.setups.alignment;
  const id = useId().replace(/:/g, '');
  const front = view === 'front';
  const corners = viewCorners(view);
  return (
    <section className="align-grid min-w-0 rounded-lg border border-border" aria-labelledby={`${id}-title`}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3">
        <h4 id={`${id}-title`} className="font-mono text-[11px] font-semibold uppercase tracking-widest text-foreground">
          {front ? a.frontView : a.rearView}
        </h4>
        <span className="rounded border border-border px-1.5 py-0.5 font-mono text-[9px] uppercase text-muted-foreground">{front ? a.lookingRearward : a.lookingForward}</span>
      </div>
      <svg viewBox="0 0 440 210" className="align-svg block h-auto w-full" role="img" aria-label={front ? a.frontView : a.rearView}>
        <line x1="34" y1="168" x2="406" y2="168" className="align-structure" />
        {Array.from({ length: 37 }, (_, i) => (
          <line key={i} x1={38 + i * 10} y1="168" x2={32 + i * 10} y2="176" className="align-structure" opacity="0.4" />
        ))}
        <text x="402" y="190" textAnchor="end">
          {a.ground.toUpperCase()}
        </text>
        {/* The compared setups' car seen end on, standing on the ground (EngineeringCarView.tsx); its own wheels hidden,
            as each is drawn here leaned by its camber */}
        <EngineeringCarLayer view={front ? 'front' : 'rear'} fit={FIT} showWheels={false}>
          {(car) => (
            <>
        <line x1={car.centerlineX ?? 220} y1="40" x2={car.centerlineX ?? 220} y2="168" className="align-reference" />
        {corners.map((corner, index) => {
          const item = findItem(props.comparison, corner, 'camber');
          return (
            <AlignmentWheel
              key={corner}
              x={car.wheel(corner)?.[0] ?? (index === 0 ? 96 : 344)}
              y={(car.groundY ?? 168) - 6}
              variant="elevation"
              layers={camberLayers(props.comparison, corner, view, props.mode, props.exaggeration)}
              selected={props.selected === corner}
              onSelect={() => props.onSelect(corner)}
              name={fmt(a.selectWheel, { corner: a.corners[corner] })}
              tooltip={fmt(a.wheelTooltip, {
                corner: `${a.corners[corner]} · ${a.params.camber}`,
                baseline: formatAlignment(item?.baseline ?? null),
                comparison: formatAlignment(item?.comparison ?? null),
              })}
              labelSide={index === 0 ? 'left' : 'right'}
              shortName={a.cornerShort[corner]}
              noDataText={a.noData.toUpperCase()}
            />
          );
        })}
            </>
          )}
        </EngineeringCarLayer>
      </svg>
      <div className="grid grid-cols-2 gap-3 border-t border-border px-4 py-3 text-xs">
        {corners.map((corner) => {
          const item = findItem(props.comparison, corner, 'camber');
          const direction = item ? changeDirection(item) : null;
          return (
            <div key={corner} className={`min-w-0 ${props.selected === corner ? 'text-foreground' : ''}`}>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {a.corners[corner]} · {a.cornerShort[corner]}
              </div>
              <div className="mt-0.5 flex flex-wrap gap-x-2 font-mono tabular-nums">
                <span className={item?.status === 'same' ? 'text-align-neutral' : 'text-align-baseline'}>{formatAlignment(item?.baseline ?? null)}</span>
                <span className={item?.status === 'same' ? 'text-align-neutral' : 'text-align-comparison'}>{formatAlignment(item?.comparison ?? null)}</span>
                <span className="text-muted-foreground">Δ {formatAlignment(item?.delta ?? null, true)}</span>
              </div>
              {direction && item?.delta && direction !== 'unchanged' && (
                <p className="mt-0.5 text-muted-foreground">{fmt(a.direction[direction], { amount: formatAlignment({ ...item.delta, value: Math.abs(item.delta.value) }) })}</p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
