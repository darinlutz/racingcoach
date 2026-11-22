import { multiply, type Mat4 } from './carModels/matrix.ts';
import type { WheelAnchors } from './carModels/modelRules.ts';

// The Suspension tab's axonometric overview (SuspensionCarOverview.tsx): one projection for the SVG drawing and the
// car's 3D model drawn faintly behind it (SuspensionModelGhost.tsx), so the two line up. The drawing's space is in
// meters: x back from the front axle, y across from the right side, z up from the ground. Pure, no I/O.

export const WHEELBASE = 2.6;
export const TRACK = 1.6;
export const TIRE_R = 0.32;
export const SCALE = 125; // px per meter
export const ORIGIN = [450, 235] as const;
// The drawing's viewBox: x, y, width, height
export const VIEWBOX = [40, 70, 960, 610] as const;

export type P3 = [number, number, number];

export const project = ([x, y, z]: P3): [number, number] => [ORIGIN[0] + (x - y) * 0.866 * SCALE, ORIGIN[1] + (x + y) * 0.5 * SCALE - z * SCALE];

// Column-major, as matrix.ts and three.js keep them, from rows
const fromRows = (r: number[][]): Mat4 => [0, 1, 2, 3].flatMap((c) => [0, 1, 2, 3].map((row) => r[row][c]));

// The drawing's space to three.js's for the overview's camera: x and y the SVG's (y turned up, as three.js's is), and
// z the depth toward the viewer. The projection looks along (1, 1, 1) (the direction both screen axes are square to),
// so a point is nearer the further it is along it
export const DRAWING_TO_THREE: Mat4 = fromRows([
  [0.866 * SCALE, -0.866 * SCALE, 0, ORIGIN[0]],
  [-0.5 * SCALE, -0.5 * SCALE, SCALE, -ORIGIN[1]],
  [SCALE, SCALE, SCALE, 0],
  [0, 0, 0, 1],
]);

// A car's model (in the canonical frame: meters, +X forward, +Y left, +Z up, origin on the ground under the car's
// middle) in the drawing's space: scaled the same way every way so its wheelbase is the drawing's, its front axle on the
// drawing's, and centered across the track. Null when its wheel centers don't give a wheelbase
export function canonicalToDrawing(wheels: WheelAnchors): Mat4 | null {
  const front = (wheels.LF.x + wheels.RF.x) / 2;
  const rear = (wheels.LR.x + wheels.RR.x) / 2;
  const wheelbase = front - rear;
  if (!Number.isFinite(wheelbase) || wheelbase <= 0.5) return null;
  const k = WHEELBASE / wheelbase;
  // The middle of the four wheel centers across the car, put on the drawing's middle
  const across = (wheels.LF.y + wheels.RF.y + wheels.LR.y + wheels.RR.y) / 4;
  return fromRows([
    [-k, 0, 0, front * k],
    [0, k, 0, TRACK / 2 - across * k],
    [0, 0, k, 0],
    [0, 0, 0, 1],
  ]);
}

// The whole chain for a model file: its normalization (raw to canonical), into the drawing, into three.js's space
export function modelToThree(normalization: Mat4, wheels: WheelAnchors): Mat4 | null {
  const toDrawing = canonicalToDrawing(wheels);
  return toDrawing ? multiply(DRAWING_TO_THREE, multiply(toDrawing, normalization)) : null;
}
