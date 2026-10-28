// Building meshes for deck.gl's SimpleMeshLayer by hand: Lap Compare's 3D road (lapModel3d.ts) and cars
// (carModel3d.ts). Coordinates are meters: x, y and z up.

export type Vec3 = [number, number, number];

// A mesh as deck.gl's SimpleMeshLayer takes it: non-indexed triangles, with each vertex's normal and color
// (multiplied by the layer's color)
export type Mesh = {
  attributes: {
    positions: { size: 3; value: Float32Array };
    normals: { size: 3; value: Float32Array };
    colors: { size: 3; value: Float32Array };
  };
};

// Faces meeting at a sharper angle than this (its cosine, about 50°) keep a hard edge in loft's shading
const CREASE = Math.cos((50 * Math.PI) / 180);

export class MeshBuilder {
  positions: number[] = [];
  normals: number[] = [];
  colors: number[] = [];

  triangle(a: Vec3, b: Vec3, c: Vec3, normal: Vec3 | [Vec3, Vec3, Vec3], color: Vec3) {
    const perVertex = Array.isArray(normal[0]) ? (normal as [Vec3, Vec3, Vec3]) : null;
    [a, b, c].forEach((p, i) => {
      this.positions.push(...p);
      this.normals.push(...(perVertex ? perVertex[i] : (normal as Vec3)));
      this.colors.push(...color);
    });
  }

  // A flat four-sided face, its normal pointing away from `inside`
  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, color: Vec3, inside: Vec3) {
    const n = outward(cross(sub(c, a), sub(d, b)), centroid([a, b, c, d]), inside);
    this.triangle(a, b, c, n, color);
    this.triangle(a, c, d, n, color);
  }

  // A flat polygon (a cap), as a fan from its centroid, its normal pointing away from `inside`
  polygon(points: Vec3[], color: Vec3, inside: Vec3) {
    const center = centroid(points);
    // Newell's method, so a slightly bent ring still gets a sensible normal
    const sum: Vec3 = [0, 0, 0];
    points.forEach((p, i) => {
      const q = points[(i + 1) % points.length];
      sum[0] += (p[1] - q[1]) * (p[2] + q[2]);
      sum[1] += (p[2] - q[2]) * (p[0] + q[0]);
      sum[2] += (p[0] - q[0]) * (p[1] + q[1]);
    });
    const n = outward(sum, center, inside);
    points.forEach((p, i) => this.triangle(center, p, points[(i + 1) % points.length], n, color));
  }

  // A six-sided solid from its bottom and top rectangles, each given as [xMin, xMax, yMin, yMax] at height z
  block(bottom: [number, number, number, number], z0: number, top: [number, number, number, number], z1: number, color: Vec3) {
    const corners = ([x0, x1, y0, y1]: number[], z: number): Vec3[] => [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]];
    const [b, t] = [corners(bottom, z0), corners(top, z1)];
    const inside = centroid([...b, ...t]);
    this.quad(b[0], b[1], b[2], b[3], color, inside);
    this.quad(t[0], t[1], t[2], t[3], color, inside);
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      this.quad(b[i], b[j], t[j], t[i], color, inside);
    }
  }

  // A surface through rings of points (each the same length), shaded smoothly except across creases sharper
  // than CREASE. closed joins each ring's last point back to its first. colorOf colors the face between rings
  // s and s + 1 and points k and k + 1. inside gives a point inside the solid near a face's center: the rings
  // all run the same way round, so every face's normal points the same way, and the faces vote on which
  // way is out (a single point can't tell for every face of a shape with hollows, such as wheel arches).
  loft(rings: Vec3[][], closed: boolean, colorOf: (s: number, k: number) => Vec3, inside: (center: Vec3) => Vec3) {
    const count = rings[0].length;
    const segments = closed ? count : count - 1;
    const at = (s: number, k: number) => rings[s][k % count];
    let votes = 0;
    const raw = rings.slice(0, -1).map((_, s) =>
      Array.from({ length: segments }, (_, k) => {
        const [a, b, c, d] = [at(s, k), at(s + 1, k), at(s + 1, k + 1), at(s, k + 1)];
        const n = normalize(cross(sub(c, a), sub(d, b)));
        const center = centroid([a, b, c, d]);
        votes += Math.sign(dot(n, sub(center, inside(center))));
        return n;
      })
    );
    const faces = raw.map((row) => row.map((n): Vec3 => (votes < 0 ? [-n[0], -n[1], -n[2]] : n)));
    // A corner's normal: the average of the faces around it that meet this face at a gentle angle
    const cornerNormal = (s: number, k: number, face: Vec3): Vec3 => {
      const sum: Vec3 = [0, 0, 0];
      for (const fs of [s - 1, s]) {
        if (fs < 0 || fs >= faces.length) continue;
        for (let fk of [k - 1, k]) {
          if (closed) fk = (fk + segments) % segments;
          else if (fk < 0 || fk >= segments) continue;
          const n = faces[fs][fk];
          if (dot(n, face) > CREASE) for (let i = 0; i < 3; i++) sum[i] += n[i];
        }
      }
      return normalize(sum);
    };
    faces.forEach((row, s) =>
      row.forEach((face, k) => {
        const [a, b, c, d] = [at(s, k), at(s + 1, k), at(s + 1, k + 1), at(s, k + 1)];
        const [na, nb, nc, nd] = [
          cornerNormal(s, k, face),
          cornerNormal(s + 1, k, face),
          cornerNormal(s + 1, k + 1, face),
          cornerNormal(s, k + 1, face),
        ];
        const color = colorOf(s, k);
        this.triangle(a, b, c, [na, nb, nc], color);
        this.triangle(a, c, d, [na, nc, nd], color);
      })
    );
  }

  build(): Mesh {
    return {
      attributes: {
        positions: { size: 3, value: new Float32Array(this.positions) },
        normals: { size: 3, value: new Float32Array(this.normals) },
        colors: { size: 3, value: new Float32Array(this.colors) },
      },
    };
  }
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
export function dot(a: Vec3, b: Vec3) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
export function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(...v) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}
export function centroid(points: Vec3[]): Vec3 {
  const sum: Vec3 = [0, 0, 0];
  for (const p of points) for (let i = 0; i < 3; i++) sum[i] += p[i] / points.length;
  return sum;
}
// The unit normal n, turned to point from `inside` toward `center`
function outward(n: Vec3, center: Vec3, inside: Vec3): Vec3 {
  const unit = normalize(n);
  return dot(unit, sub(center, inside)) < 0 ? [-unit[0], -unit[1], -unit[2]] : unit;
}
