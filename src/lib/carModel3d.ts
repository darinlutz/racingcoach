// The car in Lap Compare's 3D model (TrackLineMap3D): a GT3-style car about 4.75 m long and 2.1 m wide,
// facing +x with its left side to +y, standing on z = 0 (meters). Drawn as five meshes so each can be
// colored its own way: the body (white, painted the lap's color by its layer; the glass dark), the details
// (carbon, tub, number panels: their own colors), the headlights and brake lights (unlit, the brake lights
// lit by the lap's brake), and the wheels (WHEELS gives where they go, so the front ones can steer).

import { MeshBuilder, type Mesh, type Vec3 } from '@/lib/mesh3d';

export const WHEEL_RADIUS = 0.34;
const WHEEL_HALF_WIDTH = 0.155;

// Wheel centers in the car's frame: front and rear axles 2.7 m apart, 1.66 m track
export const WHEELS: { x: number; y: number; front: boolean }[] = [
  { x: 1.49, y: 0.83, front: true },
  { x: 1.49, y: -0.83, front: true },
  { x: -1.21, y: 0.83, front: false },
  { x: -1.21, y: -0.83, front: false },
];
const AXLES = [1.49, -1.21];
// The wheel arches: half-circles this big around each wheel's center, cut out of the body's sides
const ARCH_RADIUS = 0.41;
// How far in from each side the wheel wells reach; inside them is the floor
const WELL_INNER = 0.63;

const BODY: Vec3 = [1, 1, 1];
const GLASS: Vec3 = [0.09, 0.11, 0.13];
const CARBON: Vec3 = [0.08, 0.08, 0.09];
const FLOOR: Vec3 = [0.06, 0.06, 0.07];
const PANEL: Vec3 = [0.94, 0.94, 0.94];
const TIRE: Vec3 = [0.07, 0.07, 0.08];
const RIM: Vec3 = [0.62, 0.63, 0.66];
const RIM_DARK: Vec3 = [0.14, 0.14, 0.15];
const LIGHT: Vec3 = [1, 1, 1];

// The body's shape along its length, front to back: x, then the half-width at the sill (w), the height and
// half-width of the shoulder over the fenders (zs, wt), the top's height on the center line (zt: the hood
// sits between the front fenders) and the floor's height (zb)
const PROFILE: [number, number, number, number, number, number][] = [
  [2.4, 0.78, 0.27, 0.7, 0.26, 0.13],
  [2.32, 0.92, 0.4, 0.86, 0.37, 0.1],
  [2.12, 1.0, 0.58, 0.92, 0.51, 0.1],
  [1.86, 1.03, 0.78, 0.95, 0.6, 0.1],
  [1.49, 1.04, 0.89, 0.96, 0.66, 0.1],
  [1.1, 1.03, 0.85, 0.94, 0.72, 0.1],
  [0.9, 0.98, 0.77, 0.9, 0.75, 0.1],
  [0.3, 0.97, 0.76, 0.89, 0.77, 0.1],
  [-0.5, 0.98, 0.78, 0.9, 0.79, 0.1],
  [-0.9, 1.02, 0.86, 0.94, 0.84, 0.1],
  [-1.21, 1.05, 0.93, 0.97, 0.88, 0.1],
  [-1.6, 1.04, 0.93, 0.96, 0.9, 0.1],
  [-2.0, 1.0, 0.91, 0.94, 0.9, 0.16],
  [-2.3, 0.95, 0.86, 0.9, 0.88, 0.22],
  [-2.36, 0.9, 0.8, 0.86, 0.82, 0.3],
];
const NOSE = PROFILE[0][0];
const TAIL = PROFILE[PROFILE.length - 1][0];

type Section = { w: number; zs: number; wt: number; zt: number; zb: number; arch: number };

// The body's cross-section at x; arch is how high the sides' bottom edge is there (above a wheel, the arch)
function sectionAt(x: number): Section {
  let i = 0;
  while (i < PROFILE.length - 2 && x < PROFILE[i + 1][0]) i++;
  const [a, b] = [PROFILE[i], PROFILE[i + 1]];
  const f = Math.max(0, Math.min(1, (a[0] - x) / (a[0] - b[0])));
  const v = (k: number) => a[k] + f * (b[k] - a[k]);
  let arch = v(5);
  for (const axle of AXLES) {
    const d = Math.abs(x - axle);
    if (d < ARCH_RADIUS) arch = Math.max(arch, WHEEL_RADIUS + Math.sqrt(ARCH_RADIUS ** 2 - d ** 2));
  }
  return { w: v(1), zs: v(2), wt: v(3), zt: v(4), zb: v(5), arch };
}

// The left half of a cross-section as [y, z], from the floor's center out under the wheel well, up the side,
// over the shoulder to the top's center
function halfSection(s: Section): [number, number][] {
  const sideTop = Math.max(s.arch + 0.06, s.zs - 0.1);
  return [
    [0, s.zb],
    [WELL_INNER - 0.02, s.zb],
    [WELL_INNER, s.arch],
    [s.w - 0.04, s.arch],
    [s.w, s.arch + 0.03],
    [s.w, sideTop],
    [s.wt, s.zs],
    [s.wt * 0.55, s.zt],
    [0, s.zt + 0.01],
  ];
}

// The body's top surface height at (x, y), for parts that sit on it
function surfaceZ(x: number, y: number) {
  const s = sectionAt(x);
  const top = halfSection(s).slice(5).reverse(); // from the center out
  const ay = Math.abs(y);
  for (let i = 1; i < top.length; i++) {
    const [[y0, z0], [y1, z1]] = [top[i - 1], top[i]];
    if (ay <= y1) return z0 + ((ay - y0) / (y1 - y0 || 1)) * (z1 - z0);
  }
  return top[top.length - 1][1];
}

function ring(x: number): Vec3[] {
  const half = halfSection(sectionAt(x));
  const left = half.map(([y, z]): Vec3 => [x, y, z]);
  // The right side back down, without repeating the center points
  const right = half.slice(1, -1).reverse().map(([y, z]): Vec3 => [x, -y, z]);
  return [...left, ...right];
}

// Where the body's cross-sections are: every 4 cm, plus either side of each arch's ends so they're crisp
function sectionXs() {
  const xs = new Set<number>();
  for (let x = NOSE; x > TAIL; x -= 0.04) xs.add(Number(x.toFixed(3)));
  xs.add(TAIL);
  for (const axle of AXLES) for (const d of [-ARCH_RADIUS, -ARCH_RADIUS + 0.004, ARCH_RADIUS - 0.004, ARCH_RADIUS]) xs.add(axle + d);
  return [...xs].sort((a, b) => b - a);
}

// The cabin: x, roof height and the roof's half-width, front (the windscreen's foot) to back
const CABIN: [number, number, number][] = [
  [0.95, 0.77, 0.62],
  [0.6, 0.96, 0.6],
  [0.2, 1.16, 0.57],
  [-0.3, 1.19, 0.57],
  [-0.75, 1.16, 0.56],
  [-1.15, 1.02, 0.53],
  [-1.6, 0.9, 0.5],
];

function cabinRing([x, roof, half]: [number, number, number]): Vec3[] {
  const s = sectionAt(x);
  const [belt, foot] = [s.zt - 0.03, s.wt * 0.9];
  return [
    [x, foot, belt],
    [x, half, roof - 0.07],
    [x, half * 0.65, roof],
    [x, -half * 0.65, roof],
    [x, -half, roof - 0.07],
    [x, -foot, belt],
  ];
}

export const CAR_BODY_MESH: Mesh = (() => {
  const m = new MeshBuilder();
  const xs = sectionXs();
  const rings = xs.map(ring);
  const middle = (x: number): Vec3 => {
    const s = sectionAt(x);
    return [x, 0, (s.zb + s.zt) / 2];
  };
  m.loft(rings, true, () => BODY, ([x]) => middle(x));
  m.polygon(rings[0], BODY, [NOSE - 0.3, 0, 0.3]);
  m.polygon(rings[rings.length - 1], BODY, [TAIL + 0.3, 0, 0.5]);

  // Cabin: windscreen, side windows and rear window dark, roof and pillars the body's color
  const cabin = CABIN.map(cabinRing);
  m.loft(
    cabin,
    false,
    (s, k) => {
      const x = (CABIN[s][0] + CABIN[s + 1][0]) / 2;
      const side = k === 0 || k === 4;
      const glass = side ? x > -1.0 && x < 0.75 : x > 0.2 || x < -0.75;
      return glass ? GLASS : BODY;
    },
    ([x]) => [x, 0, 0.6]
  );
  m.polygon(cabin[0], GLASS, [0.5, 0, 0.6]);
  m.polygon(cabin[cabin.length - 1], BODY, [-1, 0, 0.6]);

  // Mirrors on short stalks
  for (const side of [1, -1]) {
    const y = (a: number, b: number): [number, number] => (side > 0 ? [a, b] : [-b, -a]);
    m.block([0.66, 0.84, ...y(1.0, 1.15)], 0.84, [0.68, 0.82, ...y(1.0, 1.14)], 0.96, BODY);
    m.block([0.72, 0.78, ...y(0.86, 1.0)], 0.86, [0.72, 0.78, ...y(0.86, 1.0)], 0.89, CARBON);
  }
  return m.build();
})();

// A thin piece lying on the body's top surface, given by its corners' x and y: a grid of small faces raised a
// little above it, so it follows the curve rather than sinking into it
function onSurface(m: MeshBuilder, corners: [number, number][], color: Vec3) {
  const steps = 6;
  const [a, b, c, d] = corners;
  const at = (u: number, v: number): Vec3 => {
    const x = (1 - v) * ((1 - u) * a[0] + u * b[0]) + v * ((1 - u) * d[0] + u * c[0]);
    const y = (1 - v) * ((1 - u) * a[1] + u * b[1]) + v * ((1 - u) * d[1] + u * c[1]);
    return [x, y, surfaceZ(x, y) + 0.015];
  };
  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < steps; j++) {
      const [u0, u1, v0, v1] = [i / steps, (i + 1) / steps, j / steps, (j + 1) / steps];
      const p = at(u0, v0);
      m.quad(p, at(u1, v0), at(u1, v1), at(u0, v1), color, [p[0], p[1], p[2] - 1]);
    }
  }
}

export const CAR_DETAIL_MESH: Mesh = (() => {
  const m = new MeshBuilder();
  // Floor under the cabin, between the wheel wells
  m.block([-1.95, 2.0, -WELL_INNER + 0.01, WELL_INNER - 0.01], 0.07, [-1.95, 2.0, -WELL_INNER + 0.01, WELL_INNER - 0.01], 0.12, FLOOR);
  // Front splitter and canards
  m.block([2.0, 2.5, -0.98, 0.98], 0.05, [2.0, 2.48, -0.98, 0.98], 0.09, CARBON);
  for (const side of [1, -1]) {
    const y = (a: number, b: number): [number, number] => (side > 0 ? [a, b] : [-b, -a]);
    m.block([2.1, 2.34, ...y(0.86, 1.02)], 0.24, [2.12, 2.34, ...y(0.86, 1.02)], 0.26, CARBON);
    m.block([2.0, 2.24, ...y(0.9, 1.04)], 0.34, [2.02, 2.24, ...y(0.9, 1.04)], 0.36, CARBON);
  }
  // Grille in the nose
  m.quad([NOSE + 0.005, -0.5, 0.15], [NOSE + 0.005, 0.5, 0.15], [NOSE + 0.005, 0.5, 0.25], [NOSE + 0.005, -0.5, 0.25], CARBON, [NOSE - 1, 0, 0.2]);
  // Hood vents over the front wheels
  for (const side of [1, -1]) {
    for (let i = 0; i < 4; i++) {
      const x = 1.3 + i * 0.12;
      onSurface(m, [[x, side * 0.56], [x + 0.07, side * 0.56], [x + 0.07, side * 0.84], [x, side * 0.84]], CARBON);
    }
  }
  // Rear diffuser with fins
  m.block([-2.5, -1.9, -0.82, 0.82], 0.07, [-2.48, -1.9, -0.82, 0.82], 0.2, CARBON);
  for (const y of [-0.55, -0.25, 0.25, 0.55]) m.block([-2.5, -2.0, y - 0.01, y + 0.01], 0.07, [-2.5, -2.0, y - 0.01, y + 0.01], 0.27, CARBON);
  // Rear wing: swan-neck mounts, the wing, its endplates
  for (const side of [1, -1]) {
    const y = (a: number, b: number): [number, number] => (side > 0 ? [a, b] : [-b, -a]);
    m.block([-2.32, -2.22, ...y(0.3, 0.35)], surfaceZ(-2.27, 0.32) - 0.02, [-2.42, -2.34, ...y(0.3, 0.35)], 1.17, CARBON);
    m.block([-2.7, -2.12, ...y(0.99, 1.01)], 0.98, [-2.7, -2.12, ...y(0.99, 1.01)], 1.26, CARBON);
  }
  m.block([-2.66, -2.2, -0.99, 0.99], 1.11, [-2.64, -2.24, -0.99, 0.99], 1.17, CARBON);
  m.block([-2.72, -2.6, -0.99, 0.99], 1.17, [-2.72, -2.62, -0.99, 0.99], 1.23, CARBON);
  // Number panels on the doors
  for (const side of [1, -1]) {
    const y = side * (sectionAt(-0.1).w + 0.012);
    m.quad([-0.45, y, 0.3], [0.25, y, 0.3], [0.25, y, 0.62], [-0.45, y, 0.62], PANEL, [-0.1, 0, 0.45]);
  }
  return m.build();
})();

export const HEADLIGHT_MESH: Mesh = (() => {
  const m = new MeshBuilder();
  for (const side of [1, -1]) {
    onSurface(m, [[2.06, side * 0.52], [2.27, side * 0.5], [2.27, side * 0.82], [2.06, side * 0.86]], LIGHT);
  }
  return m.build();
})();

export const BRAKE_LIGHT_MESH: Mesh = (() => {
  const m = new MeshBuilder();
  const x = TAIL - 0.006;
  const lamp = (y0: number, y1: number, z0: number, z1: number) =>
    m.quad([x, y0, z0], [x, y1, z0], [x, y1, z1], [x, y0, z1], LIGHT, [TAIL + 1, 0, 0.6]);
  lamp(0.42, 0.8, 0.6, 0.71);
  lamp(-0.8, -0.42, 0.6, 0.71);
  // The light bar across the tail between them
  lamp(-0.42, 0.42, 0.66, 0.69);
  return m.build();
})();

// A wheel around the y axis, centered on the origin: a tire with rounded shoulders, and on each face a dark
// rim with five silver spokes, the rim's lip and a center nut
export const WHEEL_MESH: Mesh = (() => {
  const m = new MeshBuilder();
  const sides = 28;
  const h = WHEEL_HALF_WIDTH;
  const profile: [number, number][] = [
    [0.25, -h],
    [0.31, -h - 0.005],
    [WHEEL_RADIUS - 0.005, -h + 0.03],
    [WHEEL_RADIUS, -h + 0.06],
    [WHEEL_RADIUS, h - 0.06],
    [WHEEL_RADIUS - 0.005, h - 0.03],
    [0.31, h + 0.005],
    [0.25, h],
  ];
  const around = (r: number, y: number, a: number): Vec3 => [r * Math.cos(a), y, r * Math.sin(a)];
  const rings = Array.from({ length: sides + 1 }, (_, i) => profile.map(([r, y]) => around(r, y, (i / sides) * 2 * Math.PI)));
  m.loft(rings, false, () => TIRE, ([, y]) => [0, y, 0]);

  for (const side of [1, -1]) {
    const y = side * h;
    const out: Vec3 = [0, side, 0];
    const disc = (r0: number, r1: number, at: number, color: Vec3) => {
      for (let i = 0; i < sides; i++) {
        const [a0, a1] = [(i / sides) * 2 * Math.PI, ((i + 1) / sides) * 2 * Math.PI];
        const [p, q, s, t] = [around(r0, at, a0), around(r0, at, a1), around(r1, at, a1), around(r1, at, a0)];
        m.triangle(p, q, s, out, color);
        m.triangle(p, s, t, out, color);
      }
    };
    disc(0, 0.25, y, RIM_DARK);
    disc(0.215, 0.25, y + side * 0.002, RIM);
    disc(0, 0.05, y + side * 0.004, RIM);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * 2 * Math.PI;
      const [along, across] = [[Math.cos(a), Math.sin(a)], [-Math.sin(a), Math.cos(a)]];
      const point = (r: number, w: number): Vec3 => [r * along[0] + w * across[0], y + side * 0.003, r * along[1] + w * across[1]];
      const [p, q, s, t] = [point(0.05, -0.028), point(0.22, -0.02), point(0.22, 0.02), point(0.05, 0.028)];
      m.triangle(p, q, s, out, RIM);
      m.triangle(p, s, t, out, RIM);
    }
  }
  return m.build();
})();
