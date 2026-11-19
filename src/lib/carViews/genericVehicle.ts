// The built-in generic GT3-class car (docs/car-views.md): what every engineering drawing shows for a car without an
// approved drawing of its own, labelled as generic wherever it appears. It isn't any particular car: its dimensions
// below are illustrative round numbers of the class, never a car's, and none of its anchors is verified. Pure; the
// markup it builds goes through the same sanitizer as an upload (svgSanitize.ts), so both reach a page the same way.
//
// Each view draws its tires the way that view sees them (TIRE_PROFILE in views.ts): round sidewalls from the side, the
// footprint (tread width by diameter) from above, and the tread width end on from the front and rear.

import type { CarViewArt, ViewAnchors } from './anchors.ts';
import { sanitizeSvg } from './svgSanitize.ts';
import type { CarView, Corner } from './views.ts';

// Illustrative dimensions in mm (not a real car's)
export const GENERIC_DIMENSIONS = {
  length: 4550,
  frontOverhang: 1000,
  wheelbase: 2640,
  bodyHalfWidth: 1020,
  frontHalfTrack: 850,
  rearHalfTrack: 840,
  tireRadius: 340,
  rimRadius: 230,
  frontTireWidth: 305,
  rearTireWidth: 325,
  floorHeight: 95,
} as const;

const D = GENERIC_DIMENSIONS;
const SIDE = { width: 5000, height: 1500, ground: 1400, nose: 225 };
const TOP = { width: 2400, height: 5000, nose: 225, center: 1200 };
const END = { width: 2400, height: 1500, ground: 1400, center: 1200 };

const n = (v: number) => Math.round(v * 10) / 10;
const pt = (x: number, y: number) => `${n(x)} ${n(y)}`;
const approx = (x: number, y: number, vb: { width: number; height: number }) => ({ x: x / vb.width, y: y / vb.height, verified: false });
const svg = (vb: { width: number; height: number }, body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vb.width} ${vb.height}">${body}</svg>`;

// From the left side, nose left. (dx from the nose, h above the ground)
function leftSideMarkup(): string {
  const P = (dx: number, h: number) => pt(SIDE.nose + dx, SIDE.ground - h);
  const front = D.frontOverhang;
  const rear = D.frontOverhang + D.wheelbase;
  const arch = 395;
  const half = Math.sqrt(arch ** 2 - (D.tireRadius - D.floorHeight) ** 2);
  const body =
    `M${P(0, D.floorHeight)} L${P(0, 250)} L${P(120, 360)} L${P(560, 600)} L${P(700, 720)} Q${P(1000, 790)} ${P(1340, 730)} ` +
    `L${P(1600, 790)} L${P(2050, 1110)} Q${P(2400, 1215)} ${P(2800, 1170)} L${P(3350, 920)} L${P(3560, 860)} ` +
    `Q${P(rear, 900)} ${P(4200, 840)} L${P(4520, 800)} L${P(4550, 560)} L${P(4550, 250)} L${P(4380, 120)} ` +
    `L${P(rear + half, D.floorHeight)} A${arch} ${arch} 0 1 0 ${P(rear - half, D.floorHeight)} ` +
    `L${P(front + half, D.floorHeight)} A${arch} ${arch} 0 1 0 ${P(front - half, D.floorHeight)} Z`;
  const glass = `M${P(1700, 820)} L${P(2070, 1080)} Q${P(2400, 1170)} ${P(2780, 1130)} L${P(3200, 900)} L${P(3150, 840)} Z`;
  const details = `M${P(1650, 250)} L${P(1650, 780)} M${P(3200, 250)} L${P(3250, 830)} M${P(3000, 400)} Q${P(3150, 500)} ${P(3300, 420)} M${P(560, 600)} L${P(1500, 640)}`;
  const lights = `M${P(150, 380)} L${P(500, 570)} L${P(580, 540)} L${P(230, 350)} Z M${P(4420, 770)} L${P(4540, 760)} L${P(4545, 690)} L${P(4430, 700)} Z`;
  const aero =
    `<rect class="ecv-aero" data-part="splitter" x="${SIDE.nose - 40}" y="${SIDE.ground - D.floorHeight}" width="600" height="25"/>` +
    `<path class="ecv-aero" data-part="diffuser" d="M${P(4100, D.floorHeight)} L${P(4560, 260)} L${P(4560, 230)} L${P(4120, 70)} Z"/>` +
    `<path class="ecv-panel" data-part="wing-mount" d="M${P(3980, 880)} L${P(4250, 1160)} M${P(4120, 860)} L${P(4380, 1160)}"/>` +
    `<path class="ecv-aero" data-part="wing-endplate" d="M${P(4120, 1020)} L${P(4580, 1020)} L${P(4580, 1270)} L${P(4180, 1270)} Z"/>`;
  const wheel = (corner: Corner, dx: number) => {
    const cx = SIDE.nose + dx;
    const cy = SIDE.ground - D.tireRadius;
    return (
      `<g data-part="wheel" data-corner="${corner}"><circle class="ecv-tire" data-part="tire" cx="${cx}" cy="${cy}" r="${D.tireRadius}"/>` +
      `<circle class="ecv-rim" data-part="rim" cx="${cx}" cy="${cy}" r="${D.rimRadius}"/><circle class="ecv-rim" cx="${cx}" cy="${cy}" r="70"/></g>`
    );
  };
  return (
    `<title>Generic GT3-class car, left side</title>` +
    `<g data-layer="body"><path class="ecv-body" d="${body}"/></g>` +
    `<g data-layer="glass"><path class="ecv-glass" d="${glass}"/></g>` +
    `<g data-layer="details"><path class="ecv-panel" d="${details}"/></g>` +
    `<g data-layer="lights"><path class="ecv-light" d="${lights}"/></g>` +
    `<g data-layer="aero">${aero}</g>` +
    `<g data-layer="wheels">${wheel('LF', front)}${wheel('LR', rear)}</g>`
  );
}

function sideAnchors(mirror: boolean): ViewAnchors {
  const X = (dx: number) => (mirror ? SIDE.width - (SIDE.nose + dx) : SIDE.nose + dx);
  const front = D.frontOverhang;
  const rear = D.frontOverhang + D.wheelbase;
  const [f, r]: [Corner, Corner] = mirror ? ['RF', 'RR'] : ['LF', 'LR'];
  const cy = SIDE.ground - D.tireRadius;
  return {
    wheelCenters: { [f]: approx(X(front), cy, SIDE), [r]: approx(X(rear), cy, SIDE) },
    contactPatches: { [f]: approx(X(front), SIDE.ground, SIDE), [r]: approx(X(rear), SIDE.ground, SIDE) },
    rideHeightPoints: { [f]: approx(X(front), SIDE.ground - D.floorHeight, SIDE), [r]: approx(X(rear), SIDE.ground - D.floorHeight, SIDE) },
    groundY: SIDE.ground / SIDE.height,
    centerlineX: null,
    splitter: approx(X(0), SIDE.ground - 82, SIDE),
    diffuser: approx(X(4330), SIDE.ground - 180, SIDE),
    wing: approx(X(4350), SIDE.ground - 1190, SIDE),
  };
}

// From above, nose up. Half-widths along the car from the nose
const PLAN: [number, number][] = [
  [0, 640],
  [60, 820],
  [250, 960],
  [600, 1010],
  [1650, 1010],
  [1850, 930],
  [2700, 940],
  [3300, 1015],
  [4250, 1015],
  [4450, 960],
  [4550, 880],
];

function topMarkup(): string {
  const c = TOP.center;
  const Y = (dy: number) => TOP.nose + dy;
  const outline = [...PLAN.map(([dy, w]) => pt(c - w, Y(dy))), ...[...PLAN].reverse().map(([dy, w]) => pt(c + w, Y(dy)))];
  const body = `M${outline.join(' L')} Z`;
  const trap = (y0: number, y1: number, w0: number, w1: number) => `M${pt(c - w0, Y(y0))} L${pt(c + w0, Y(y0))} L${pt(c + w1, Y(y1))} L${pt(c - w1, Y(y1))} Z`;
  const glass = `${trap(1720, 2120, 700, 600)} ${trap(2900, 3250, 600, 520)}`;
  const details =
    `${trap(2120, 2900, 600, 600)} M${pt(c - 450, Y(400))} L${pt(c - 520, Y(1500))} M${pt(c + 450, Y(400))} L${pt(c + 520, Y(1500))} ` +
    `M${pt(c - 300, Y(3400))} L${pt(c + 300, Y(3400))} M${pt(c - 300, Y(3550))} L${pt(c + 300, Y(3550))} M${pt(c - 300, Y(3700))} L${pt(c + 300, Y(3700))} ` +
    `M${pt(c - 1010, Y(1850))} L${pt(c - 1150, Y(1880))} L${pt(c - 1140, Y(1960))} L${pt(c - 1010, Y(1950))} ` +
    `M${pt(c + 1010, Y(1850))} L${pt(c + 1150, Y(1880))} L${pt(c + 1140, Y(1960))} L${pt(c + 1010, Y(1950))}`;
  const aero =
    `<rect class="ecv-aero" data-part="splitter" x="${c - 980}" y="${TOP.nose - 40}" width="1960" height="45"/>` +
    `<rect class="ecv-aero" data-part="wing" x="${c - 1000}" y="${Y(4330)}" width="2000" height="190"/>` +
    `<rect class="ecv-aero" data-part="wing-endplate" x="${c - 1020}" y="${Y(4300)}" width="50" height="260"/>` +
    `<rect class="ecv-aero" data-part="wing-endplate" x="${c + 970}" y="${Y(4300)}" width="50" height="260"/>`;
  const tire = (corner: Corner, x: number, dy: number, width: number) =>
    `<g data-part="wheel" data-corner="${corner}"><rect class="ecv-tire" data-part="tire" x="${n(x - width / 2)}" y="${n(Y(dy) - D.tireRadius)}" width="${width}" height="${D.tireRadius * 2}" rx="40"/>` +
    `<path class="ecv-rim" d="M${pt(x - width / 2 + 40, Y(dy))} L${pt(x + width / 2 - 40, Y(dy))}"/></g>`;
  const front = D.frontOverhang;
  const rear = D.frontOverhang + D.wheelbase;
  return (
    `<title>Generic GT3-class car, from above</title>` +
    `<g data-layer="body"><path class="ecv-body" d="${body}"/></g>` +
    `<g data-layer="glass"><path class="ecv-glass" d="${glass}"/></g>` +
    `<g data-layer="details"><path class="ecv-panel" d="${details}"/></g>` +
    `<g data-layer="aero">${aero}</g>` +
    `<g data-layer="wheels">${tire('LF', c - D.frontHalfTrack, front, D.frontTireWidth)}${tire('RF', c + D.frontHalfTrack, front, D.frontTireWidth)}` +
    `${tire('LR', c - D.rearHalfTrack, rear, D.rearTireWidth)}${tire('RR', c + D.rearHalfTrack, rear, D.rearTireWidth)}</g>`
  );
}

function topAnchors(): ViewAnchors {
  const c = TOP.center;
  const front = TOP.nose + D.frontOverhang;
  const rear = TOP.nose + D.frontOverhang + D.wheelbase;
  const wheels = {
    LF: approx(c - D.frontHalfTrack, front, TOP),
    RF: approx(c + D.frontHalfTrack, front, TOP),
    LR: approx(c - D.rearHalfTrack, rear, TOP),
    RR: approx(c + D.rearHalfTrack, rear, TOP),
  };
  return {
    wheelCenters: wheels,
    contactPatches: { ...wheels },
    rideHeightPoints: {
      LF: approx(c - D.frontHalfTrack + 260, front, TOP),
      RF: approx(c + D.frontHalfTrack - 260, front, TOP),
      LR: approx(c - D.rearHalfTrack + 260, rear, TOP),
      RR: approx(c + D.rearHalfTrack - 260, rear, TOP),
    },
    groundY: null,
    centerlineX: 0.5,
    splitter: approx(c, TOP.nose - 18, TOP),
    diffuser: null,
    wing: approx(c, TOP.nose + 4425, TOP),
  };
}

// End on: the front (looking rearward, the car's left on the screen's right) or the rear (looking forward). (w across
// from the centerline, h above the ground)
function endMarkup(view: 'front' | 'rear'): string {
  const c = END.center;
  const P = (w: number, h: number) => pt(c + w, END.ground - h);
  const front = view === 'front';
  const right: [number, number][] = front
    ? [
        [990, D.floorHeight],
        [1020, 180],
        [1020, 600],
        [970, 740],
        [850, 790],
        [700, 770],
        [560, 720],
        [540, 860],
        [440, 1190],
        [0, 1210],
      ]
    : [
        [1000, D.floorHeight],
        [1020, 260],
        [1020, 700],
        [960, 820],
        [700, 840],
        [520, 900],
        [440, 1180],
        [0, 1200],
      ];
  const outline = [...right.map(([w, h]) => P(w, h)), ...[...right].reverse().slice(1).map(([w, h]) => P(-w, h))];
  const body = `M${P(0, D.floorHeight)} L${outline.join(' L')} Z`;
  const glass = front ? `M${P(520, 880)} L${P(430, 1170)} L${P(-430, 1170)} L${P(-520, 880)} Z` : `M${P(500, 920)} L${P(430, 1160)} L${P(-430, 1160)} L${P(-500, 920)} Z`;
  const box = (w0: number, w1: number, h0: number, h1: number) => `M${P(w0, h0)} L${P(w1, h0)} L${P(w1, h1)} L${P(w0, h1)} Z`;
  const details = front
    ? `${box(-420, 420, 200, 380)} ${box(600, 900, 180, 330)} ${box(-900, -600, 180, 330)} ${box(560, 760, 900, 980)} ${box(-760, -560, 900, 980)}`
    : `${box(-300, 300, 420, 560)} ${box(-940, -760, 300, 380)} ${box(760, 940, 300, 380)}`;
  const lights = front ? `${box(600, 950, 480, 600)} ${box(-950, -600, 480, 600)}` : `${box(640, 960, 640, 720)} ${box(-960, -640, 640, 720)}`;
  const behind = front
    ? `<path class="ecv-aero" data-part="wing" d="${box(-980, 980, 1180, 1240)}"/>`
    : '';
  const aero = front
    ? `<path class="ecv-aero" data-part="splitter" d="${box(-1010, 1010, 55, D.floorHeight)}"/>`
    : `<path class="ecv-panel" data-part="wing-mount" d="M${P(-260, 830)} L${P(-260, 1150)} M${P(260, 830)} L${P(260, 1150)}"/>` +
      `<path class="ecv-aero" data-part="wing" d="${box(-990, 990, 1150, 1240)}"/>` +
      `<path class="ecv-aero" data-part="wing-endplate" d="${box(-1010, -970, 1000, 1270)} ${box(970, 1010, 1000, 1270)}"/>` +
      `<path class="ecv-aero" data-part="diffuser" d="${box(-760, 760, 60, 300)} ${[-570, -380, -190, 0, 190, 380, 570].map((w) => `M${P(w, 60)} L${P(w, 300)}`).join(' ')}"/>`;
  const halfTrack = front ? D.frontHalfTrack : D.rearHalfTrack;
  const width = front ? D.frontTireWidth : D.rearTireWidth;
  // The car's left is on the screen's right from the front, and on the left from behind
  const corners: [Corner, number][] = front
    ? [
        ['RF', -halfTrack],
        ['LF', halfTrack],
      ]
    : [
        ['LR', -halfTrack],
        ['RR', halfTrack],
      ];
  const tire = ([corner, w]: [Corner, number]) => {
    const x = c + w - width / 2;
    const top = END.ground - D.tireRadius * 2;
    return (
      `<g data-part="wheel" data-corner="${corner}"><rect class="ecv-tire" data-part="tire" x="${n(x)}" y="${top}" width="${width}" height="${D.tireRadius * 2}" rx="70"/>` +
      `<path class="ecv-rim" d="M${pt(x + 34, top + 60)} L${pt(x + 34, END.ground - 60)} M${pt(x + width - 34, top + 60)} L${pt(x + width - 34, END.ground - 60)}"/></g>`
    );
  };
  return (
    `<title>Generic GT3-class car, ${front ? 'front' : 'rear'}</title>` +
    (behind ? `<g data-layer="aero">${behind}</g>` : '') +
    `<g data-layer="body"><path class="ecv-body" d="${body}"/></g>` +
    `<g data-layer="glass"><path class="ecv-glass" d="${glass}"/></g>` +
    `<g data-layer="details"><path class="ecv-panel" d="${details}"/></g>` +
    `<g data-layer="lights"><path class="ecv-light" d="${lights}"/></g>` +
    `<g data-layer="aero">${aero}</g>` +
    `<g data-layer="wheels">${corners.map(tire).join('')}</g>`
  );
}

function endAnchors(view: 'front' | 'rear'): ViewAnchors {
  const c = END.center;
  const front = view === 'front';
  const halfTrack = front ? D.frontHalfTrack : D.rearHalfTrack;
  const [left, right]: [Corner, Corner] = front ? ['RF', 'LF'] : ['LR', 'RR'];
  const cy = END.ground - D.tireRadius;
  const rh = END.ground - D.floorHeight;
  return {
    wheelCenters: { [left]: approx(c - halfTrack, cy, END), [right]: approx(c + halfTrack, cy, END) },
    contactPatches: { [left]: approx(c - halfTrack, END.ground, END), [right]: approx(c + halfTrack, END.ground, END) },
    rideHeightPoints: { [left]: approx(c - halfTrack + 250, rh, END), [right]: approx(c + halfTrack - 250, rh, END) },
    groundY: END.ground / END.height,
    centerlineX: 0.5,
    splitter: front ? approx(c, END.ground - 75, END) : null,
    diffuser: front ? null : approx(c, END.ground - 180, END),
    wing: approx(c, END.ground - 1200, END),
  };
}

// The generic car's markup and anchors for each view, before sanitizing (the tests check both)
export function genericSources(): Record<CarView, { source: string; anchors: ViewAnchors }> {
  const left = leftSideMarkup();
  return {
    'left-side': { source: svg(SIDE, left), anchors: sideAnchors(false) },
    // The generic car is symmetrical, so its right side is its left mirrored; a real car's never is
    'right-side': {
      source: svg(
        SIDE,
        `<g transform="matrix(-1 0 0 1 ${SIDE.width} 0)">${left
          .replace('left side', 'right side')
          .replace('data-corner="LF"', 'data-corner="RF"')
          .replace('data-corner="LR"', 'data-corner="RR"')}</g>`
      ),
      anchors: sideAnchors(true),
    },
    top: { source: svg(TOP, topMarkup()), anchors: topAnchors() },
    front: { source: svg(END, endMarkup('front')), anchors: endAnchors('front') },
    rear: { source: svg(END, endMarkup('rear')), anchors: endAnchors('rear') },
  };
}

const cache = new Map<CarView, CarViewArt>();

// The generic car's drawing of one view, sanitized once and kept
export function genericArt(view: CarView): CarViewArt {
  const cached = cache.get(view);
  if (cached) return cached;
  const { source, anchors } = genericSources()[view];
  const result = sanitizeSvg(source);
  if (!result.ok) throw new Error(`Generic car ${view} drawing failed the sanitizer: ${JSON.stringify(result.problems)}`);
  const art: CarViewArt = { viewBox: result.svg.viewBox, inner: result.svg.inner, anchors, hasWheels: true };
  cache.set(view, art);
  return art;
}
