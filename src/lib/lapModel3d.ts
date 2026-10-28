// Lap Compare's 3D model of a focus area (TrackLineMap3D), built only from the laps themselves: a road
// following the lead lap's line at its altitude (Alt), the laps' lines on it, and a car per lap (carModel3d.ts)
// posed from its telemetry. Everything is in meters east, north and up from the lead lap's first position
// (deck.gl's METER_OFFSETS), the height above the area's lowest point and multiplied by the height scale.
// The lap files have no Pitch or Roll and nothing tells where the track's edges are, so the road is a fixed
// width around the lead line (wider when the other lap strays further), flat across, and each car pitches
// with the road's slope but doesn't roll.

import { WHEEL_RADIUS, WHEELS } from '@/lib/carModel3d';
import type { AreaTrace } from '@/lib/lapData';
import { MeshBuilder, type Mesh, type Vec3 } from '@/lib/mesh3d';

export type { Vec3 };

// The road's half-width (m) around the lead line: a typical road course is 12-15 m wide
const MIN_HALF_WIDTH = 6.5;
// ...and at least this far (m) beyond the furthest the other lap's line strays from it
const EDGE_MARGIN = 1.5;
const MAX_HALF_WIDTH = 20;
// Distance (m) between the road's cross-sections
export const STATION_SPACING = 0.5;
// Cross-sections either side whose altitudes are averaged, smoothing iRacing's small steps
const HEIGHT_SMOOTHING = 4;
// Samples either side giving the direction of travel and the slope
const TRAVEL_SPAN = 4;
// Steering wheel angle / front wheel angle, as LapDataTabs estimates it for a typical GT3 car
const STEERING_RATIO = 11;

// One lap's line in the model: each sample's position (m east, north) and height on the road (m, scaled)
export type ModelLine = { trace: AreaTrace; points: [number, number][]; heights: number[] };

export type RoadModel = {
  lines: ModelLine[];
  road: Mesh;
  // The road's two edges, for edge lines, and where the time gap wall stands (just outside the left edge),
  // with each cross-section's lap position (the lead lap's pct)
  leftEdge: Vec3[];
  rightEdge: Vec3[];
  wallBase: { position: Vec3; pct: number }[];
  halfWidth: number;
  // [min east, min north, max east, max north] of the road (m)
  bounds: [number, number, number, number];
  // The area's climb and drop along the lead line (m, real, not scaled), null when no lap has altitudes
  rise: number | null;
  fall: number | null;
};

// Meters east and north of origin, [lat, lon] in degrees; plenty accurate over a focus area
export function toLocal([lat0, lon0]: [number, number], [lat, lon]: [number, number]): [number, number] {
  return [(lon - lon0) * 111_320 * Math.cos((lat0 * Math.PI) / 180), (lat - lat0) * 110_540];
}

// The reverse of toLocal: [lon, lat] for deck.gl's view
export function toLngLat([lat0, lon0]: [number, number], [east, north]: [number, number]): [number, number] {
  return [lon0 + east / (111_320 * Math.cos((lat0 * Math.PI) / 180)), lat0 + north / 110_540];
}

function nearest(points: [number, number][], [x, y]: [number, number]) {
  let best = 0;
  let bestDistance = Infinity;
  points.forEach(([px, py], i) => {
    const d = (px - x) ** 2 + (py - y) ** 2;
    if (d < bestDistance) [best, bestDistance] = [i, d];
  });
  return { index: best, distance: Math.sqrt(bestDistance) };
}

// Builds the area's model from the laps with positions, the first one (the lead) giving the road
export function buildRoadModel(traces: AreaTrace[], origin: [number, number], heightScale: number): RoadModel {
  const linesPoints = traces.map((trace) => trace.positions!.map((p) => toLocal(origin, p)));
  const lead = linesPoints[0];
  const leadPcts = traces[0].pcts;

  // Cross-sections every STATION_SPACING m along the lead line
  const stations: { point: [number, number]; pct: number }[] = [];
  let travelled = 0;
  let next = 0;
  for (let i = 1; i < lead.length; i++) {
    const length = Math.hypot(lead[i][0] - lead[i - 1][0], lead[i][1] - lead[i - 1][1]);
    while (length > 0 && next <= travelled + length) {
      const f = (next - travelled) / length;
      stations.push({
        point: [lead[i - 1][0] + f * (lead[i][0] - lead[i - 1][0]), lead[i - 1][1] + f * (lead[i][1] - lead[i - 1][1])],
        pct: leadPcts[i - 1] + f * (leadPcts[i] - leadPcts[i - 1]),
      });
      next += STATION_SPACING;
    }
    travelled += length;
  }
  const stationPoints = stations.map((s) => s.point);

  // The road's altitude at each cross-section, from the lead lap's, or the other lap's where the lead has none
  const source = traces.findIndex((trace) => trace.altitudes !== null);
  const rawAltitudes =
    source < 0
      ? null
      : stationPoints.map((point) => traces[source].altitudes![nearest(linesPoints[source], point).index]);
  const smoothed = rawAltitudes?.map((_, i) => {
    const window = rawAltitudes.slice(Math.max(0, i - HEIGHT_SMOOTHING), i + HEIGHT_SMOOTHING + 1);
    return window.reduce((sum, a) => sum + a, 0) / window.length;
  });
  const lowest = smoothed ? Math.min(...smoothed) : 0;
  const stationHeights = smoothed ? smoothed.map((a) => (a - lowest) * heightScale) : stationPoints.map(() => 0);
  let rise = 0;
  let fall = 0;
  smoothed?.forEach((a, i) => {
    if (i === 0) return;
    if (a > smoothed[i - 1]) rise += a - smoothed[i - 1];
    else fall += smoothed[i - 1] - a;
  });

  // Each lap's line sits on the road at the nearest cross-section, and the road is wide enough for both
  let furthest = 0;
  const lines = traces.map((trace, k): ModelLine => {
    const points = linesPoints[k];
    const heights = points.map((point) => {
      const { index, distance } = nearest(stationPoints, point);
      if (k > 0) furthest = Math.max(furthest, distance);
      return stationHeights[index];
    });
    return { trace, points, heights };
  });
  const halfWidth = Math.min(MAX_HALF_WIDTH, Math.max(MIN_HALF_WIDTH, furthest + EDGE_MARGIN));

  // Each cross-section's left direction, from the line either side of it
  const lefts = stationPoints.map((_, i) => {
    const [a, b] = [stationPoints[Math.max(0, i - 2)], stationPoints[Math.min(stationPoints.length - 1, i + 2)]];
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    const length = Math.hypot(dx, dy) || 1;
    return [-dy / length, dx / length] as [number, number];
  });
  const edge = (i: number, side: number, offset = halfWidth): Vec3 => [
    stationPoints[i][0] + side * offset * lefts[i][0],
    stationPoints[i][1] + side * offset * lefts[i][1],
    stationHeights[i],
  ];
  const leftEdge = stationPoints.map((_, i) => edge(i, 1));
  const rightEdge = stationPoints.map((_, i) => edge(i, -1));

  // The road's surface, and its sides down to the ground (height 0) so the climbs and drops read as solid
  const m = new MeshBuilder();
  const ASPHALT: Vec3 = [0.3, 0.31, 0.33];
  const SIDE: Vec3 = [0.17, 0.19, 0.22];
  const ground = (p: Vec3): Vec3 => [p[0], p[1], 0];
  for (let i = 1; i < stationPoints.length; i++) {
    const [l0, l1, r0, r1] = [leftEdge[i - 1], leftEdge[i], rightEdge[i - 1], rightEdge[i]];
    const below: Vec3 = [(l0[0] + r1[0]) / 2, (l0[1] + r1[1]) / 2, -1000];
    m.quad(l0, l1, r1, r0, ASPHALT, below);
    const middle: Vec3 = [stationPoints[i][0], stationPoints[i][1], stationHeights[i] / 2];
    if (l0[2] > 0 || l1[2] > 0) m.quad(ground(l0), ground(l1), l1, l0, SIDE, middle);
    if (r0[2] > 0 || r1[2] > 0) m.quad(ground(r0), ground(r1), r1, r0, SIDE, middle);
  }

  const all = [...leftEdge, ...rightEdge];
  return {
    lines,
    road: m.build(),
    leftEdge,
    rightEdge,
    wallBase: stations.map((s, i) => ({ position: edge(i, 1, halfWidth + 0.8), pct: s.pct })),
    halfWidth,
    bounds: [
      Math.min(...all.map((p) => p[0])),
      Math.min(...all.map((p) => p[1])),
      Math.max(...all.map((p) => p[0])),
      Math.max(...all.map((p) => p[1])),
    ],
    rise: smoothed ? rise : null,
    fall: smoothed ? fall : null,
  };
}

// Where a car is and how it's turned at one moment. yaw is where the nose points and travel where the car is
// going (degrees counterclockwise from east, as deck.gl orients meshes); pitch is nose down (degrees, as
// deck.gl's), from the road's scaled slope. slip is the sideslip (degrees, + travelling left of the nose),
// steer the front wheels' angle (degrees, + left), brake the brake pedal (0-1)
export type CarPose = {
  position: Vec3;
  yaw: number;
  travel: number;
  pitch: number;
  slip: number | null;
  steer: number;
  brake: number;
  speed: number;
  gear: number;
  pct: number;
};

const DEGREES = 180 / Math.PI;

function lerp(values: number[], f: number) {
  const i = Math.min(Math.floor(f), values.length - 1);
  const j = Math.min(i + 1, values.length - 1);
  return values[i] + (f - i) * (values[j] - values[i]);
}

// The direction (degrees counterclockwise from east) and slope (rise per meter) of travel around sample i
function travelAt({ points, heights }: ModelLine, i: number) {
  const [a, b] = [Math.max(0, i - TRAVEL_SPAN), Math.min(points.length - 1, i + TRAVEL_SPAN)];
  const [dx, dy] = [points[b][0] - points[a][0], points[b][1] - points[a][1]];
  const run = Math.hypot(dx, dy);
  return { direction: Math.atan2(dy, dx) * DEGREES, slope: run > 0.1 ? (heights[b] - heights[a]) / run : 0 };
}

// The car's pose at a fractional sample index of its line
export function poseAt(line: ModelLine, f: number): CarPose {
  const { trace, points, heights } = line;
  const index = Math.max(0, Math.min(f, points.length - 1));
  const i = Math.round(index);
  const { direction, slope } = travelAt(line, i);
  // headings are compass bearings (radians clockwise from north); without them the car points where it goes
  const yaw = trace.headings ? 90 - trace.headings[i] * DEGREES : direction;
  const sideslip = trace.handling.sideslips[i];
  return {
    position: [lerp(points.map((p) => p[0]), index), lerp(points.map((p) => p[1]), index), lerp(heights, index)],
    yaw,
    travel: direction,
    pitch: -Math.atan(slope) * DEGREES,
    slip: Number.isFinite(sideslip) ? sideslip * DEGREES : null,
    steer: (trace.steerings[i] / STEERING_RATIO) * DEGREES,
    brake: trace.brakes[i],
    speed: trace.speeds[i],
    gear: trace.engine.gears[i],
    pct: lerp(trace.pcts, index),
  };
}

// The four wheels' centers and orientations for a car pose (the front ones steered)
export function wheelsOf(pose: CarPose) {
  const [yaw, pitch] = [pose.yaw / DEGREES, -pose.pitch / DEGREES];
  return WHEELS.map(({ x, y, front }) => {
    // Pitch the offset (nose up is positive here), then turn it to the car's heading
    const [fx, fz] = [x * Math.cos(pitch), x * Math.sin(pitch) + WHEEL_RADIUS];
    return {
      position: [
        pose.position[0] + fx * Math.cos(yaw) - y * Math.sin(yaw),
        pose.position[1] + fx * Math.sin(yaw) + y * Math.cos(yaw),
        pose.position[2] + fz,
      ] as Vec3,
      orientation: [pose.pitch, pose.yaw + (front ? pose.steer : 0), 0] as Vec3,
    };
  });
}
