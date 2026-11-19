// The engineering anchors of one view of a car drawing (docs/car-views.md): where its wheel centers, contact patches,
// ride height reference points, ground line, centerline and aero parts are, as fractions (0-1) of the drawing's
// viewBox, so the overlays (ride heights, toe, brake shares...) find them whatever the drawing's size. Pure, no I/O.
//
// An anchor says whether a person checked it against the car (`verified`); one that isn't is drawn and flagged as an
// approximation. A part the view can't show, or that nobody has placed, is absent, never given made-up coordinates.

import { CORNERS, hasGround, SCREEN_ORDER, visibleCorners, type CarView, type Corner } from './views.ts';

export type AnchorPoint = { x: number; y: number; verified: boolean };
export type CornerAnchors = Partial<Record<Corner, AnchorPoint>>;

export type ViewAnchors = {
  wheelCenters: CornerAnchors;
  contactPatches: CornerAnchors;
  // Where the car's ride height is measured from at each corner. iRacing doesn't say where that is on each car, so
  // these are approximations unless a person verified them for the car
  rideHeightPoints: CornerAnchors;
  // The ground line's height (every view but the top)
  groundY: number | null;
  // The car's centerline across the drawing (top, front and rear views)
  centerlineX: number | null;
  splitter: AnchorPoint | null;
  diffuser: AnchorPoint | null;
  wing: AnchorPoint | null;
};

export type ViewBox = { x: number; y: number; width: number; height: number };

// One view's drawing: its viewBox, its sanitized markup (everything inside <svg>) and its anchors. `hasWheels` says
// the markup draws the wheels (in its data-layer="wheels" group), so nothing draws them again over it
export type CarViewArt = { viewBox: ViewBox; inner: string; anchors: ViewAnchors; hasWheels: boolean };

export const emptyAnchors = (): ViewAnchors => ({
  wheelCenters: {},
  contactPatches: {},
  rideHeightPoints: {},
  groundY: null,
  centerlineX: null,
  splitter: null,
  diffuser: null,
  wing: null,
});

export type AnchorProblem =
  | { code: 'notObject' }
  | { code: 'outOfRange'; anchor: string }
  | { code: 'missingWheel'; corner: Corner }
  | { code: 'hiddenCorner'; corner: Corner; anchor: string }
  | { code: 'orientation'; first: Corner; second: Corner }
  | { code: 'missingGround' }
  | { code: 'groundInTopView' }
  | { code: 'wheelBelowGround'; corner: Corner }
  | { code: 'contactOffGround'; corner: Corner };

const inRange = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;
const CONTACT_TOLERANCE = 0.02;

function readPoint(value: unknown): AnchorPoint | null | 'bad' {
  if (value == null) return null;
  if (typeof value !== 'object') return 'bad';
  const { x, y, verified } = value as Record<string, unknown>;
  if (!inRange(x) || !inRange(y)) return 'bad';
  return { x, y, verified: verified === true };
}

// Reads anchors from JSON (an Admin's upload), keeping only what's valid, and lists every problem. A view with
// problems can't be submitted for review
export function parseViewAnchors(view: CarView, raw: unknown): { anchors: ViewAnchors; problems: AnchorProblem[] } {
  const problems: AnchorProblem[] = [];
  const anchors = emptyAnchors();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { anchors, problems: [{ code: 'notObject' }] };
  const r = raw as Record<string, unknown>;
  const visible = new Set(visibleCorners(view));
  for (const group of ['wheelCenters', 'contactPatches', 'rideHeightPoints'] as const) {
    const source = r[group];
    if (source == null) continue;
    if (typeof source !== 'object') {
      problems.push({ code: 'outOfRange', anchor: group });
      continue;
    }
    for (const corner of CORNERS) {
      const value = (source as Record<string, unknown>)[corner];
      const point = readPoint(value);
      if (point === null) continue;
      if (point === 'bad') problems.push({ code: 'outOfRange', anchor: `${group}.${corner}` });
      else if (!visible.has(corner)) problems.push({ code: 'hiddenCorner', corner, anchor: group });
      else anchors[group][corner] = point;
    }
  }
  for (const key of ['groundY', 'centerlineX'] as const) {
    if (r[key] == null) continue;
    if (inRange(r[key])) anchors[key] = r[key] as number;
    else problems.push({ code: 'outOfRange', anchor: key });
  }
  for (const key of ['splitter', 'diffuser', 'wing'] as const) {
    const point = readPoint(r[key]);
    if (point === 'bad') problems.push({ code: 'outOfRange', anchor: key });
    else anchors[key] = point;
  }
  return { anchors, problems: [...problems, ...checkViewAnchors(view, anchors)] };
}

// The rules every view's anchors keep: each corner the view shows has a wheel center; the corners are on the sides of
// the screen the view's orientation puts them (views.ts), so a drawing mirrored by mistake is refused rather than
// relabelled; the wheels are above the ground and the contact patches on it
export function checkViewAnchors(view: CarView, anchors: ViewAnchors): AnchorProblem[] {
  const problems: AnchorProblem[] = [];
  const wheels = anchors.wheelCenters;
  for (const corner of visibleCorners(view)) if (!wheels[corner]) problems.push({ code: 'missingWheel', corner });
  const order = SCREEN_ORDER[view];
  const pairs: [Corner, Corner, 'x' | 'y'][] =
    view === 'top'
      ? [
          ['LF', 'RF', 'x'],
          ['LR', 'RR', 'x'],
          ['LF', 'LR', 'y'],
          ['RF', 'RR', 'y'],
        ]
      : [[order[0], order[1], 'x']];
  for (const [first, second, axis] of pairs) {
    const a = wheels[first];
    const b = wheels[second];
    if (a && b && !(a[axis] < b[axis])) problems.push({ code: 'orientation', first, second });
  }
  if (hasGround(view)) {
    if (anchors.groundY == null) problems.push({ code: 'missingGround' });
    else {
      for (const corner of visibleCorners(view)) {
        const wheel = wheels[corner];
        if (wheel && wheel.y >= anchors.groundY) problems.push({ code: 'wheelBelowGround', corner });
        const contact = anchors.contactPatches[corner];
        if (contact && Math.abs(contact.y - anchors.groundY) > CONTACT_TOLERANCE) problems.push({ code: 'contactOffGround', corner });
      }
    }
  } else if (anchors.groundY != null) problems.push({ code: 'groundInTopView' });
  return problems;
}

// How many of a view's anchors a person verified, for the debug overlay and the Admin page
export function verifiedShare(anchors: ViewAnchors): { verified: number; total: number } {
  const points = [
    ...Object.values(anchors.wheelCenters),
    ...Object.values(anchors.contactPatches),
    ...Object.values(anchors.rideHeightPoints),
    anchors.splitter,
    anchors.diffuser,
    anchors.wing,
  ].filter((p): p is AnchorPoint => !!p);
  return { verified: points.filter((p) => p.verified).length, total: points.length };
}

// Where a host drawing puts a view: inside a box (centered, the whole drawing showing), standing on its ground line
// across a width (the ground anchor lands on groundY), or, from above, with its axles at two heights
export type CarFit =
  | { kind: 'box'; x: number; y: number; width: number; height: number }
  | { kind: 'ground'; x: number; width: number; groundY: number; maxHeight: number }
  | { kind: 'axles'; centerX: number; frontY: number; rearY: number };

// A view drawn at `scale`, moved by (tx, ty), in the host drawing's coordinates
export type CarPlacement = { scale: number; tx: number; ty: number; viewBox: ViewBox };

const mean = (values: number[]) => values.reduce((s, v) => s + v, 0) / values.length;

export function placeView(art: Pick<CarViewArt, 'viewBox' | 'anchors'>, fit: CarFit): CarPlacement {
  const vb = art.viewBox;
  const boxed = (x: number, y: number, width: number, height: number): CarPlacement => {
    const scale = Math.min(width / vb.width, height / vb.height);
    return { scale, tx: x + (width - vb.width * scale) / 2 - vb.x * scale, ty: y + (height - vb.height * scale) / 2 - vb.y * scale, viewBox: vb };
  };
  if (fit.kind === 'box') return boxed(fit.x, fit.y, fit.width, fit.height);
  if (fit.kind === 'ground') {
    const ground = art.anchors.groundY;
    if (ground == null) return boxed(fit.x, fit.groundY - fit.maxHeight, fit.width, fit.maxHeight);
    const above = ground * vb.height;
    const scale = Math.min(fit.width / vb.width, fit.maxHeight / above);
    return { scale, tx: fit.x + (fit.width - vb.width * scale) / 2 - vb.x * scale, ty: fit.groundY - above * scale - vb.y * scale, viewBox: vb };
  }
  const w = art.anchors.wheelCenters;
  const fronts = [w.LF, w.RF].filter((p): p is AnchorPoint => !!p).map((p) => p.y);
  const rears = [w.LR, w.RR].filter((p): p is AnchorPoint => !!p).map((p) => p.y);
  if (!fronts.length || !rears.length || mean(rears) <= mean(fronts)) {
    const height = (fit.rearY - fit.frontY) * 1.6;
    return boxed(fit.centerX - height / 2, fit.frontY - height * 0.2, height, height);
  }
  const frontV = mean(fronts) * vb.height;
  const rearV = mean(rears) * vb.height;
  const scale = (fit.rearY - fit.frontY) / (rearV - frontV);
  const centerV = (art.anchors.centerlineX ?? 0.5) * vb.width;
  return { scale, tx: fit.centerX - (vb.x + centerV) * scale, ty: fit.frontY - (vb.y + frontV) * scale, viewBox: vb };
}

// A normalized anchor in the host drawing's coordinates
export const toHost = (p: CarPlacement, point: { x: number; y: number }): [number, number] => [
  p.tx + (p.viewBox.x + point.x * p.viewBox.width) * p.scale,
  p.ty + (p.viewBox.y + point.y * p.viewBox.height) * p.scale,
];

export const hostY = (p: CarPlacement, y: number) => p.ty + (p.viewBox.y + y * p.viewBox.height) * p.scale;
export const hostX = (p: CarPlacement, x: number) => p.tx + (p.viewBox.x + x * p.viewBox.width) * p.scale;
