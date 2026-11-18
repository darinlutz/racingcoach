'use client';

import { useId } from 'react';
import AlignmentWheel from '@/components/AlignmentWheel';
import { useLanguage } from '@/components/LanguageProvider';
import type { AlignmentDiagramProps } from '@/components/TopDownToeDiagram';
import { camberLayers, changeDirection, findItem, formatAlignment, viewCorners } from '@/lib/alignmentGeometry';

// The front or rear view (FrontCamberDiagram, RearCamberDiagram): the axle's two tires standing on the ground, each
// leaned by its camber for each setup, with vertical references, angle arcs and the values under the drawing.
// From the front the car's left is on the screen's right; from behind it's on the left (viewCorners)
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
        {/* The body seen end on */}
        <path
          d={
            front
              ? 'M124 134 L132 90 Q143 77 164 77 L182 61 Q220 54 258 61 L276 77 Q297 77 308 90 L316 134 Z'
              : 'M124 136 L131 88 Q146 77 167 78 L182 61 L258 61 L273 78 Q297 77 309 88 L316 136 Z'
          }
          className="align-chassis"
        />
        <path d="M182 65 L258 65 L271 82 L169 82 Z M152 104 H288 M135 129 H305 M188 112 H252 L260 129 H180 Z" className="align-structure" />
        {front ? (
          <path d="M140 88 L166 92 L165 98 L140 96 Z M300 88 L274 92 L275 98 L300 96 Z" className="align-structure" />
        ) : (
          <path d="M136 90 H168 V94 H136 Z M272 90 H304 V94 H272 Z M132 72 H308 V76 H132 Z M168 73 V85 M272 73 V85" className="align-structure" />
        )}
        <line x1="220" y1="40" x2="220" y2="168" className="align-reference" />
        {corners.map((corner, index) => {
          const item = findItem(props.comparison, corner, 'camber');
          return (
            <AlignmentWheel
              key={corner}
              x={index === 0 ? 96 : 344}
              y={162}
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
