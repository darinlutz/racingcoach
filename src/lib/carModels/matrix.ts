// The 3D car models' one coordinate convention and its matrices (docs/car-models.md). Pure, no imports, so Node's
// tests run it directly and both renderers share it: deck.gl in Lap Compare's 3D view (TrackLineMap3D) and three.js in
// the Setups page's and Admin page's viewers (src/components/car3d/).
//
// The canonical car frame is the one Lap Compare's generic car (carModel3d.ts) was already built in: meters, +X the car's
// forward, +Y its left, +Z up, the origin on the ground under the middle of the car's plan view. Every GLB is brought
// into it by its normalization (which of its axes is up and which forward, its scale to meters, a yaw trim and an
// offset), so a model is placed the same way in every view. Matrices are 4x4 column-major, as WebGL, deck.gl and
// three.js take them.

export type Vec3 = [number, number, number];
export type Mat4 = number[];
export type Axis = '+x' | '-x' | '+y' | '-y' | '+z' | '-z';
export const AXES: Axis[] = ['+x', '-x', '+y', '-y', '+z', '-z'];
export type Bounds = { min: Vec3; max: Vec3 };

// How one GLB is brought into the canonical frame. `up` and `forward` name the model's own axes that point up and
// forward; scale turns its units into meters (glTF's are meters, so usually 1); yaw (degrees, about up) straightens a
// model that sits at an angle; offset (meters, canonical) moves the origin, e.g. to between the axles
export type Normalization = { up: Axis; forward: Axis; scale: number; yaw: number; offset: Vec3 };
// glTF's own convention is +Y up; most car models then face +Z or -Z, which the Admin picks in the preview
export const DEFAULT_NORMALIZATION: Normalization = { up: '+y', forward: '+z', scale: 1, yaw: 0, offset: [0, 0, 0] };

export const identity = (): Mat4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16).fill(0);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k];
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

export const translation = ([x, y, z]: Vec3): Mat4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
export const scaling = (s: number): Mat4 => [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0, 0, 0, 1];
export function rotationZ(degrees: number): Mat4 {
  const r = (degrees * Math.PI) / 180;
  const [c, s] = [Math.cos(r), Math.sin(r)];
  return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

export function transformPoint(m: Mat4, [x, y, z]: Vec3): Vec3 {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

// A glTF node's matrix from its translation, rotation (a unit quaternion x, y, z, w) and scale
export function fromTrs(t: Vec3 = [0, 0, 0], q: [number, number, number, number] = [0, 0, 0, 1], s: Vec3 = [1, 1, 1]): Mat4 {
  const [x, y, z, w] = q;
  const [x2, y2, z2] = [x + x, y + y, z + z];
  const [xx, xy, xz, yy, yz, zz, wx, wy, wz] = [x * x2, x * y2, x * z2, y * y2, y * z2, z * z2, w * x2, w * y2, w * z2];
  return [
    (1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0,
    (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0,
    (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}

const axisVector = (axis: Axis): Vec3 => {
  const v: Vec3 = [0, 0, 0];
  v['xyz'.indexOf(axis[1])] = axis[0] === '-' ? -1 : 1;
  return v;
};
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// Up and forward must be different axes (not the same one either way round)
export const validAxes = (up: Axis, forward: Axis) => up[1] !== forward[1];

// The rotation taking the model's axes to the canonical ones: forward to +X, up to +Z and their cross product (the
// model's left, right-handed) to +Y. Never a mirror: a model drawn mirrored stays mirrored, which the preview shows
export function basis(up: Axis, forward: Axis): Mat4 {
  if (!validAxes(up, forward)) throw new Error(`up ${up} and forward ${forward} are the same axis`);
  const f = axisVector(forward);
  const u = axisVector(up);
  const l = cross(u, f);
  // Rows f, l, u: canonical = (f·v, l·v, u·v)
  return [f[0], l[0], u[0], 0, f[1], l[1], u[1], 0, f[2], l[2], u[2], 0, 0, 0, 0, 1];
}

export function transformBounds(m: Mat4, { min, max }: Bounds): Bounds {
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const x of [min[0], max[0]]) {
    for (const y of [min[1], max[1]]) {
      for (const z of [min[2], max[2]]) {
        const p = transformPoint(m, [x, y, z]);
        for (let k = 0; k < 3; k++) {
          lo[k] = Math.min(lo[k], p[k]);
          hi[k] = Math.max(hi[k], p[k]);
        }
      }
    }
  }
  return { min: lo, max: hi };
}

// Model coordinates to the canonical frame: the axes turned and scaled, then the result centered on its plan view and
// stood on the ground (its lowest point at z = 0), then the yaw trim and the offset. Raw bounds are the model's own, as
// glb.ts measures them from its accessors
export function normalizationMatrix(n: Normalization, raw: Bounds): Mat4 {
  const turned = multiply(scaling(n.scale), basis(n.up, n.forward));
  const b = transformBounds(turned, raw);
  const center: Vec3 = [-(b.min[0] + b.max[0]) / 2, -(b.min[1] + b.max[1]) / 2, -b.min[2]];
  return multiply(translation(n.offset), multiply(rotationZ(n.yaw), multiply(translation(center), turned)));
}

// The model's size in the canonical frame (meters): length along X, width along Y, height along Z
export function canonicalBounds(n: Normalization, raw: Bounds): Bounds {
  return transformBounds(normalizationMatrix(n, raw), raw);
}
export function dimensions({ min, max }: Bounds) {
  return { length: max[0] - min[0], width: max[1] - min[1], height: max[2] - min[2] };
}

// deck.gl's pose of a mesh (getOrientation [pitch, yaw, roll] in degrees, as SimpleMeshLayer applies it: utils/matrix.js
// of @deck.gl/mesh-layers) and its position, as one matrix, so a GLB's normalization can be put under it with
// getTransformMatrix and the model sits exactly where the generic car would. Pitch is positive nose down, yaw
// counter-clockwise from east (lapModel3d.ts's CarPose)
export function deckPoseMatrix(position: Vec3, pitch: number, yaw: number, roll = 0): Mat4 {
  const [p, w, r] = [pitch, yaw, roll].map((d) => (d * Math.PI) / 180);
  const [sp, cp, sw, cw, sr, cr] = [Math.sin(p), Math.cos(p), Math.sin(w), Math.cos(w), Math.sin(r), Math.cos(r)];
  return [
    cw * cp, sw * cp, -sp, 0,
    -sw * cr + cw * sp * sr, cw * cr + sw * sp * sr, cp * sr, 0,
    sw * sr + cw * sp * cr, -cw * sr + sw * sp * cr, cp * cr, 0,
    position[0], position[1], position[2], 1,
  ];
}

// three.js is +Y up: the canonical frame's (x, y, z) is three's (x, z, -y), so the car's left is three's -Z
export const CANONICAL_TO_THREE: Mat4 = [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1];
export const toThree = ([x, y, z]: Vec3): Vec3 => [x, z, -y];
