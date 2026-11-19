// The engineering car drawings' five views and how each is oriented (docs/car-views.md). Pure, no imports: Node's
// tests run it directly. Every drawing of a car in the Setups page's engineering tabs uses these conventions, so a
// corner is always named by the car (LF is the car's left front), never by which side of the screen it's on.
//
//   top         seen from above, the nose up; the car's left on the screen's left
//   front       standing in front, looking rearward; the car's left on the screen's RIGHT
//   rear        standing behind, looking forward; the car's left on the screen's left
//   left-side   standing at the car's left, the nose pointing left
//   right-side  standing at the car's right, the nose pointing right
//
// The two side views are separate drawings: a real car isn't symmetrical, so the right side is never the left one
// mirrored (only the built-in generic car, which is, builds one from the other).

export const CAR_VIEWS = ['left-side', 'right-side', 'top', 'front', 'rear'] as const;
export type CarView = (typeof CAR_VIEWS)[number];

export const CORNERS = ['LF', 'RF', 'LR', 'RR'] as const;
export type Corner = (typeof CORNERS)[number];

export const isCarView = (value: unknown): value is CarView => typeof value === 'string' && (CAR_VIEWS as readonly string[]).includes(value);

// The corners each view shows, in screen order from left to right (top: front axle then rear axle)
export const SCREEN_ORDER: Record<CarView, readonly Corner[]> = {
  top: ['LF', 'RF', 'LR', 'RR'],
  front: ['RF', 'LF'],
  rear: ['LR', 'RR'],
  'left-side': ['LF', 'LR'],
  'right-side': ['RR', 'RF'],
};

export const visibleCorners = (view: CarView): readonly Corner[] => SCREEN_ORDER[view];
export const isFront = (corner: Corner) => corner === 'LF' || corner === 'RF';
export const isLeftCorner = (corner: Corner) => corner === 'LF' || corner === 'LR';

// How a tire looks in each view: its round sidewall from the side, its footprint (tread width by diameter) from
// above, and its width (tread width by diameter, end on) from the front and rear. A front or rear view never shows a
// tire as circles
export type TireProfile = 'sidewall' | 'footprint' | 'width';
export const TIRE_PROFILE: Record<CarView, TireProfile> = {
  'left-side': 'sidewall',
  'right-side': 'sidewall',
  top: 'footprint',
  front: 'width',
  rear: 'width',
};

// Whether the view's horizontal axis runs along the car (the side views) or across it
export const isSideView = (view: CarView) => view === 'left-side' || view === 'right-side';

// Whether the view has a ground line (every view but the top)
export const hasGround = (view: CarView) => view !== 'top';
