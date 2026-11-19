// Turns the engineering car drawings made in the Lovable project darinlutz/racingcoach-car-drawings (kept in
// data/car-drawings/, docs/car-views.md) into this site's format. Pure, no I/O.
//
// Their SVGs are line art in millimetres with two groups, <g id="body"> and <g id="wheels">; those become the layers
// the views show or hide (data-layer), so a tab that draws its own wheels hides theirs. Their anchors are absolute
// viewBox coordinates named by axle and side (front_wheel_center, rear_left_contact_patch ...), with the aero parts as
// boxes; ours are fractions of the viewBox per corner (anchors.ts), each part a point at its box's center. Nothing is
// verified (the drawings are drafts). A front or rear view's single ride height reference on the centerline isn't a
// corner's, so it's left out rather than given to a corner, and the page calls the reference points approximate.

import { emptyAnchors, type AnchorPoint, type ViewAnchors } from './anchors.ts';
import type { CarView, Corner } from './views.ts';

type Point = [number, number];
type Box = { x1: number; y1: number; x2: number; y2: number };
export type LovableView = {
  viewBox: [number, number, number, number];
  groundY?: number;
  anchors: Record<string, unknown> & { groundY?: number };
};

const isPoint = (v: unknown): v is Point => Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n));
const isBox = (v: unknown): v is Box =>
  !!v && typeof v === 'object' && ['x1', 'y1', 'x2', 'y2'].every((k) => typeof (v as Record<string, unknown>)[k] === 'number');

// Their names for each corner's anchors in each view: [wheel center, contact patch, ride height reference]
const NAMES: Record<CarView, Partial<Record<Corner, [string, string, string | null]>>> = {
  'left-side': {
    LF: ['front_wheel_center', 'front_contact_patch', 'front_ride_height_ref'],
    LR: ['rear_wheel_center', 'rear_contact_patch', 'rear_ride_height_ref'],
  },
  'right-side': {
    RF: ['front_wheel_center', 'front_contact_patch', 'front_ride_height_ref'],
    RR: ['rear_wheel_center', 'rear_contact_patch', 'rear_ride_height_ref'],
  },
  top: {
    LF: ['front_left_wheel_center', 'front_left_contact_patch', null],
    RF: ['front_right_wheel_center', 'front_right_contact_patch', null],
    LR: ['rear_left_wheel_center', 'rear_left_contact_patch', null],
    RR: ['rear_right_wheel_center', 'rear_right_contact_patch', null],
  },
  front: {
    LF: ['front_left_wheel_center', 'front_left_contact_patch', null],
    RF: ['front_right_wheel_center', 'front_right_contact_patch', null],
  },
  rear: {
    LR: ['rear_left_wheel_center', 'rear_left_contact_patch', null],
    RR: ['rear_right_wheel_center', 'rear_right_contact_patch', null],
  },
};

export function lovableViewAnchors(view: CarView, source: LovableView): ViewAnchors {
  const [vx, vy, width, height] = source.viewBox;
  const a = source.anchors;
  const point = ([x, y]: Point): AnchorPoint => ({ x: (x - vx) / width, y: (y - vy) / height, verified: false });
  const at = (name: string | null) => (name && isPoint(a[name]) ? point(a[name] as Point) : undefined);
  const center = (name: string) => (isBox(a[name]) ? point([((a[name] as Box).x1 + (a[name] as Box).x2) / 2, ((a[name] as Box).y1 + (a[name] as Box).y2) / 2]) : null);
  const anchors = emptyAnchors();
  for (const [corner, [wheel, contact, ride]] of Object.entries(NAMES[view]) as [Corner, [string, string, string | null]][]) {
    const w = at(wheel);
    const c = at(contact);
    const r = at(ride);
    if (w) anchors.wheelCenters[corner] = w;
    if (c) anchors.contactPatches[corner] = c;
    if (r) anchors.rideHeightPoints[corner] = r;
  }
  const ground = source.groundY ?? a.groundY;
  if (view !== 'top' && typeof ground === 'number') anchors.groundY = (ground - vy) / height;
  // The centerline: halfway between the wheels across the car (top, front, rear)
  if (view === 'top' || view === 'front' || view === 'rear') {
    const xs = Object.values(anchors.wheelCenters).map((p) => p!.x);
    if (xs.length >= 2) anchors.centerlineX = (Math.min(...xs) + Math.max(...xs)) / 2;
  }
  anchors.splitter = center('front_splitter');
  anchors.diffuser = center('rear_diffuser');
  anchors.wing = center('rear_wing');
  return anchors;
}

// Their body and wheels groups as this site's layers. Only the first <g id="body"> and <g id="wheels"> are tagged
export function withLovableLayers(svg: string): string {
  return svg.replace(/<g id="body"/, '<g id="body" data-layer="body"').replace(/<g id="wheels"/, '<g id="wheels" data-layer="wheels"');
}
