'use client';

import { useId } from 'react';
import AlignmentDataPanel from '@/components/AlignmentDataPanel';
import AlignmentWheel from '@/components/AlignmentWheel';
import { EngineeringCarLayer, type PlacedCar } from '@/components/EngineeringCarView';
import { useLanguage } from '@/components/LanguageProvider';
import type { CarFit } from '@/lib/carViews/anchors';
import { CORNERS, findItem, formatAlignment, isLeft, toeLayers, type AlignmentComparison, type Corner, type DisplayMode } from '@/lib/alignmentGeometry';

export type AlignmentDiagramProps = {
  comparison: AlignmentComparison;
  mode: DisplayMode;
  exaggeration: number;
  selected: Corner;
  onSelect: (corner: Corner) => void;
};

// The top view (viewBox 0 0 400 520, the nose up, the car's left on the left): the compared setups' car, its axles and centerline, and each wheel turned by its toe for each setup, with
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
            {/* The direction of travel */}
            <path d="M200 28 V52 M194 36 L200 28 L206 36" className="align-structure" />
            <text x="212" y="38">
              {a.forward.toUpperCase()}
            </text>
            <text x="206" y="500">
              {a.centerline.toUpperCase()}
            </text>
            {/* The compared setups' car from above, its axles on the drawing's (EngineeringCarView.tsx); its own wheels
                hidden, as each is drawn here turned by its toe */}
            <EngineeringCarLayer view="top" fit={FIT} showWheels={false}>
              {(car) => (
                <>
                  <line x1={car.centerlineX ?? 200} y1="40" x2={car.centerlineX ?? 200} y2="492" className="align-reference" />
                  <line x1="60" y1={wheelAt(car, 'LF')[1]} x2="340" y2={wheelAt(car, 'RF')[1]} className="align-reference" />
                  <line x1="60" y1={wheelAt(car, 'LR')[1]} x2="340" y2={wheelAt(car, 'RR')[1]} className="align-reference" />
                  {CORNERS.map((corner) => {
              const layers = toeLayers(comparison, corner, props.mode, props.exaggeration);
              const item = findItem(comparison, corner, 'toe');
              const [x, y] = wheelAt(car, corner);
              return (
                <AlignmentWheel
                  key={corner}
                  x={x}
                  y={y}
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
                </>
              )}
            </EngineeringCarLayer>
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

// Where the drawing puts the car: its front axle at y 150 and its rear at 395, on the centerline
const FIT: CarFit = { kind: 'axles', centerX: 200, frontY: 150, rearY: 395 };
// Where the wheels were drawn before the car's own drawing, in case a drawing lacks a wheel's anchor
const AT: Record<Corner, [number, number]> = { LF: [118, 150], RF: [282, 150], LR: [118, 395], RR: [282, 395] };
const wheelAt = (car: PlacedCar, corner: Corner): [number, number] => car.wheel(corner) ?? AT[corner];
