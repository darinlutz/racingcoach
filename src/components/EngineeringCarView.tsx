'use client';

import { useId, useMemo, type ReactNode } from 'react';
import { useCarAsset, useCarViewDebug } from '@/components/CarViewContext';
import { useLanguage } from '@/components/LanguageProvider';
import { placeView, toHost, verifiedShare, type AnchorPoint, type CarFit, type CarPlacement, type CarViewArt } from '@/lib/carViews/anchors';
import { resolveView, type ResolvedView } from '@/lib/carViews/assetRules';
import { scopeIds } from '@/lib/carViews/svgSanitize';
import { visibleCorners, type CarView, type Corner } from '@/lib/carViews/views';

// The engineering car drawings (docs/car-views.md). Four layers, kept apart so a change of car changes only the
// second: the host's own background (grid, ground), the car (this file: the selected car's approved drawing of the
// view, or the generic car, labelled), the host's engineering overlays (ride heights, toe, brake shares...) placed by
// the car's anchors, and labels. The overlays never move the car, and the car never changes a measurement.
//
// EngineeringCarLayer goes inside a host <svg>: it puts the view where `fit` says and hands `children` the anchors in
// the host's coordinates. EngineeringCarView is a drawing of its own (full size, or a miniature with no text).

export type PlacedCar = {
  view: CarView;
  resolved: ResolvedView;
  placement: CarPlacement;
  // The view's anchors in the host's coordinates; null where the drawing has none
  wheel: (corner: Corner) => [number, number] | null;
  contact: (corner: Corner) => [number, number] | null;
  rideHeight: (corner: Corner) => { x: number; y: number; verified: boolean } | null;
  part: (name: 'splitter' | 'diffuser' | 'wing') => [number, number] | null;
  groundY: number | null;
  centerlineX: number | null;
  // Some ride height reference point of the view is unverified or missing: its placement is approximate
  approximate: boolean;
  bounds: { x: number; y: number; width: number; height: number };
};

export function placeCar(view: CarView, resolved: ResolvedView, fit: CarFit): PlacedCar {
  const { art } = resolved;
  const placement = placeView(art, fit);
  const at = (p: AnchorPoint | null | undefined) => (p ? toHost(placement, p) : null);
  const a = art.anchors;
  const [x0, y0] = toHost(placement, { x: 0, y: 0 });
  const [x1, y1] = toHost(placement, { x: 1, y: 1 });
  return {
    view,
    resolved,
    placement,
    wheel: (c) => at(a.wheelCenters[c]),
    contact: (c) => at(a.contactPatches[c]),
    rideHeight: (c) => {
      const p = a.rideHeightPoints[c];
      if (!p) return null;
      const [x, y] = toHost(placement, p);
      return { x, y, verified: p.verified };
    },
    part: (name) => at(a[name]),
    groundY: a.groundY == null ? null : toHost(placement, { x: 0, y: a.groundY })[1],
    centerlineX: a.centerlineX == null ? null : toHost(placement, { x: a.centerlineX, y: 0 })[0],
    approximate: visibleCorners(view).some((c) => !a.rideHeightPoints[c]?.verified),
    bounds: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 },
  };
}

type Layers = { showWheels?: boolean; showAero?: boolean; showDetails?: boolean };
const layerClass = ({ showWheels = true, showAero = true, showDetails = true }: Layers, extra = '') =>
  ['ecv-art', showWheels ? '' : 'ecv-no-wheels', showAero ? '' : 'ecv-no-aero', showDetails ? '' : 'ecv-no-details', extra].filter(Boolean).join(' ');

function useResolvedView(view: CarView) {
  const entry = useCarAsset();
  const resolved = useMemo(() => resolveView(entry.asset, view), [entry.asset, view]);
  return { entry, resolved };
}

function CarArt({ art, transform, className, prefix }: { art: CarViewArt; transform?: string; className: string; prefix: string }) {
  // The markup is the sanitizer's own output (svgSanitize.ts), sanitized again by the server on reading; scopeIds only
  // prefixes its ids
  const html = useMemo(() => scopeIds(art.inner, prefix), [art.inner, prefix]);
  return <g className={className} transform={transform} aria-hidden dangerouslySetInnerHTML={{ __html: html }} />;
}

// Why the drawing isn't the car's own, for its label's tooltip
function useSourceText(resolved: ResolvedView, view: CarView, failed: boolean) {
  const { t, fmt } = useLanguage();
  const c = t.setups.carViews;
  if (resolved.source === 'preview') return { label: c.preview, title: c.preview };
  if (resolved.source !== 'generic') return null;
  const title = failed ? c.failed : resolved.reason === 'missingView' ? fmt(c.genericMissingView, { view: c.views[view] }) : c.genericTitle;
  return { label: c.generic, title };
}

export function EngineeringCarLayer({
  view,
  fit,
  label = true,
  children,
  ...layers
}: Layers & {
  view: CarView;
  fit: CarFit;
  // The "Generic vehicle" (or preview) label at the drawing's top left
  label?: boolean;
  children?: (car: PlacedCar) => ReactNode;
}) {
  const prefix = `ecv${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const debug = useCarViewDebug();
  const { entry, resolved } = useResolvedView(view);
  const car = useMemo(() => placeCar(view, resolved, fit), [view, resolved, fit]);
  const source = useSourceText(resolved, view, entry.state === 'error');
  const p = car.placement;
  return (
    <g data-car-view={view} data-car-source={resolved.source}>
      <CarArt art={resolved.art} transform={`translate(${p.tx} ${p.ty}) scale(${p.scale})`} className={layerClass(layers)} prefix={prefix} />
      {label && source && (
        <text x={car.bounds.x + 2} y={car.bounds.y + 9} className="ecv-source">
          <title>{source.title}</title>
          {source.label.toUpperCase()}
        </text>
      )}
      {children?.(car)}
      {debug && <CarDebugOverlay car={car} version={entry.asset?.version ?? null} unit={1} />}
    </g>
  );
}

// A drawing of its own. `miniature` is for a small diagram: the same drawing without its details, no text (the
// label is a tooltip) and thinner lines, kept to its proportions in whatever box it's given
export default function EngineeringCarView({
  view,
  variant = 'full',
  className,
  title,
  ...layers
}: Layers & { view: CarView; variant?: 'full' | 'miniature'; className?: string; title?: string }) {
  const prefix = `ecv${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const debug = useCarViewDebug();
  const { entry, resolved } = useResolvedView(view);
  const source = useSourceText(resolved, view, entry.state === 'error');
  const mini = variant === 'miniature';
  const vb = resolved.art.viewBox;
  const car = useMemo(() => placeCar(view, resolved, { kind: 'box', x: vb.x, y: vb.y, width: vb.width, height: vb.height }), [view, resolved, vb]);
  const name = [title, source?.title].filter(Boolean).join(' · ');
  return (
    <div className={`relative ${className ?? ''}`} data-car-view={view} data-car-source={resolved.source}>
      <svg viewBox={`${vb.x} ${vb.y} ${vb.width} ${vb.height}`} className="block h-full w-full" preserveAspectRatio="xMidYMid meet" role="img" aria-label={name || undefined}>
        {name && <title>{name}</title>}
        <CarArt art={resolved.art} className={layerClass(mini ? { ...layers, showDetails: false } : layers, mini ? 'ecv-mini' : '')} prefix={prefix} />
        {debug && <CarDebugOverlay car={car} version={entry.asset?.version ?? null} unit={Math.max(vb.width, vb.height) / (mini ? 140 : 420)} compact={mini} />}
      </svg>
      {!mini && source && (
        <span className="absolute left-1 top-1 rounded border border-border bg-card/80 px-1 py-0.5 font-mono text-[9px] uppercase tracking-wide text-muted-foreground" title={source.title}>
          {source.label}
        </span>
      )}
    </div>
  );
}

// The Admin-only SVG debug mode's marks over a drawing: its viewBox, ground line, centerline, axles, each visible
// corner's wheel center, contact patch and ride height reference point (dashed when unverified), the aero anchors,
// and which drawing it is with how many of its anchors are verified. `unit` is one host pixel, so the marks keep their
// size whatever the drawing's scale
export function CarDebugOverlay({ car, version, unit, compact = false }: { car: PlacedCar; version: number | null; unit: number; compact?: boolean }) {
  const { t, fmt } = useLanguage();
  const d = t.setups.carViews.debug;
  const u = unit;
  const b = car.bounds;
  const corners = visibleCorners(car.view);
  const share = verifiedShare(car.resolved.art.anchors);
  const font = { fontSize: 8 * u, strokeWidth: 0 } as const;
  const sourceText = car.resolved.source === 'generic' ? d.source.generic : fmt(car.resolved.source === 'approved' ? d.source.approved : d.source.preview, { version: version ?? '?' });
  const wheels = corners.map((c) => [c, car.wheel(c)] as const).filter((w): w is readonly [Corner, [number, number]] => !!w[1]);
  const axles: [number, number, number, number][] = [];
  if (car.view === 'top') {
    for (const [l, r] of [
      ['LF', 'RF'],
      ['LR', 'RR'],
    ] as const) {
      const a = car.wheel(l);
      const c = car.wheel(r);
      if (a && c) axles.push([a[0], a[1], c[0], c[1]]);
    }
  } else if (car.view === 'front' || car.view === 'rear') {
    if (wheels.length === 2) axles.push([wheels[0][1][0], wheels[0][1][1], wheels[1][1][0], wheels[1][1][1]]);
  } else {
    for (const [, [x]] of wheels) axles.push([x, b.y, x, car.groundY ?? b.y + b.height]);
  }
  return (
    <g className="ecv-debug" data-car-debug={car.view} pointerEvents="none" style={{ strokeWidth: u }}>
      <rect x={b.x} y={b.y} width={b.width} height={b.height} className="ecv-debug-bounds" strokeDasharray={`${4 * u} ${3 * u}`} />
      {car.groundY != null && (
        <g className="ecv-debug-ground">
          <line x1={b.x} x2={b.x + b.width} y1={car.groundY} y2={car.groundY} />
          {!compact && (
            <text x={b.x + b.width - 2 * u} y={car.groundY - 3 * u} textAnchor="end" style={font}>
              {d.ground}
            </text>
          )}
        </g>
      )}
      {car.centerlineX != null && (
        <g className="ecv-debug-centerline">
          <line x1={car.centerlineX} x2={car.centerlineX} y1={b.y} y2={b.y + b.height} strokeDasharray={`${6 * u} ${4 * u}`} />
          {!compact && (
            <text x={car.centerlineX + 3 * u} y={b.y + 10 * u} style={font}>
              {d.centerline}
            </text>
          )}
        </g>
      )}
      {axles.map(([x1, y1, x2, y2], i) => (
        <g key={i} className="ecv-debug-axle">
          <line x1={x1} y1={y1} x2={x2} y2={y2} strokeDasharray={`${2 * u} ${2 * u}`} />
          {!compact && (
            <text x={(x1 + x2) / 2 + 3 * u} y={(y1 + y2) / 2 - 3 * u} style={font}>
              {d.axle}
            </text>
          )}
        </g>
      ))}
      {corners.map((corner) => {
        const w = car.wheel(corner);
        const c = car.contact(corner);
        const r = car.rideHeight(corner);
        return (
          <g key={corner} data-debug-corner={corner}>
            {w && (
              <g className="ecv-debug-wheel">
                <circle cx={w[0]} cy={w[1]} r={5 * u} fill="none" />
                <line x1={w[0] - 8 * u} x2={w[0] + 8 * u} y1={w[1]} y2={w[1]} />
                <line x1={w[0]} x2={w[0]} y1={w[1] - 8 * u} y2={w[1] + 8 * u} />
                <text x={w[0] + 7 * u} y={w[1] - 7 * u} style={{ ...font, fontWeight: 700 }}>
                  {compact ? corner : `${corner} ${d.wheel}`}
                </text>
              </g>
            )}
            {c && (
              <g className="ecv-debug-contact">
                <path d={`M${c[0]} ${c[1]} l${-4 * u} ${6 * u} h${8 * u} Z`} fill="currentColor" />
                {!compact && (
                  <text x={c[0] + 6 * u} y={c[1] + 9 * u} style={font}>
                    {d.contact}
                  </text>
                )}
              </g>
            )}
            {r && (
              <g className="ecv-debug-ride">
                <path d={`M${r.x} ${r.y - 4 * u} l${4 * u} ${4 * u} l${-4 * u} ${4 * u} l${-4 * u} ${-4 * u} Z`} fill={r.verified ? 'currentColor' : 'none'} strokeDasharray={r.verified ? undefined : `${1.5 * u} ${1.5 * u}`} />
                {!compact && (
                  <text x={r.x + 6 * u} y={r.y - 3 * u} style={font}>
                    {d.ride}
                    {r.verified ? '' : ` (${d.unverified})`}
                  </text>
                )}
              </g>
            )}
          </g>
        );
      })}
      {(['splitter', 'diffuser', 'wing'] as const).map((name) => {
        const p = car.part(name);
        if (!p) return null;
        return (
          <g key={name} className="ecv-debug-aero">
            <rect x={p[0] - 3 * u} y={p[1] - 3 * u} width={6 * u} height={6 * u} fill="none" />
            {!compact && (
              <text x={p[0] + 5 * u} y={p[1] - 5 * u} style={font}>
                {d[name]}
              </text>
            )}
          </g>
        );
      })}
      {!compact && (
        <text x={b.x + 2 * u} y={b.y + b.height - 3 * u} className="ecv-debug-caption" style={font}>
          {car.view} · {sourceText} · {fmt(d.verified, { verified: share.verified, total: share.total })}
        </text>
      )}
    </g>
  );
}
