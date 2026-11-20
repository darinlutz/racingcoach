// Lap Compare's lighter copy of a car's GLB (docs/car-models.md). The 3D view draws only the model's outside shape, in
// its lap's color (modelPaint.ts), so everything else is left out of what it downloads: textures, images, texture
// coordinates, vertex colors, tangents, skins, morph targets, animations, and the interior (seats, belts, dash, steering
// wheel, roll cage, nets, inner glass: INTERIOR_PART, by the names of the part's material, mesh and nodes; never more
// than INTERIOR_MAX_SHARE of the car, so a model named oddly isn't gutted). Each triangle mesh's vertices are welded
// (vertices split only by texture seams become one again) and the mesh simplified with meshoptimizer's simplifier, to
// LITE_LIMITS.keep of its triangles (less when the model is very dense) within a small error, never emptied.
//
// Then the whole scene is flattened: every part is moved into the scene's frame (its nodes' transforms baked in, so the
// bounds the normalization was measured from are unchanged) and the parts are merged by how they're painted, into one
// node whose one mesh has a primitive per paint (a few, where the original can have thousands). deck.gl builds a
// model and draw call per primitive per car, and thousands of them froze the page. No I/O; the file route
// (carModelLite.ts) keeps the result beside the original.
//
// It returns null for a file it can't rewrite safely (sparse accessors, a missing binary chunk), and the route then
// sends the original, which the browser repaints itself (deckModel.ts).

import { MeshoptSimplifier } from 'meshoptimizer';
import { buildGlb } from './glb.ts';
import { fromTrs, identity, multiply, type Mat4, type Vec3 } from './matrix.ts';
import { DARK_SHADE, paintedMaterial, type GltfMaterial } from './modelPaint.ts';

// Bump when the output changes, so stored copies are made again
export const LITE_VERSION = 2;
export const LITE_LIMITS = {
  // Share of each mesh's triangles kept
  keep: 0.45,
  // The whole car's triangles at most (two cars are drawn every frame)
  maxTriangles: 150_000,
  // How far (a share of each mesh's size) the simplified surface may move
  targetError: 0.006,
  // Meshes this small are left alone
  minTriangles: 48,
} as const;

// Parts inside the car, by the names of their material, mesh or nodes (INT_ prefixes, but not "Paint_")
export const INTERIOR_PART =
  /interior|cockpit|(^|[^a-z])int([^a-z]|$)|seat|belt|dash|steer|roll ?cage|harness|pedal|helmet|(^|[^a-z])net([^a-z]|$)|window ?inside|(^|[^a-z])sw_|vidro_int/i;
// ...except lights, whose insides show through their lenses (e.g. a headlight's "farol_interior")
const LIGHT_PART = /light|lamp|farol/i;
// More of the car than this named like the interior is a model named oddly: then nothing is left out
const INTERIOR_MAX_SHARE = 0.5;

type Json = Record<string, unknown>;
type Accessor = {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  normalized?: boolean;
  count: number;
  type: string;
  min?: number[];
  max?: number[];
  sparse?: unknown;
};
type BufferView = { buffer?: number; byteOffset?: number; byteLength: number; byteStride?: number };
type Primitive = { attributes: Record<string, number>; indices?: number; mode?: number; material?: number };
type GltfNode = {
  name?: unknown;
  children?: number[];
  mesh?: number;
  matrix?: number[];
  translation?: Vec3;
  rotation?: [number, number, number, number];
  scale?: Vec3;
};
type GltfMesh = { name?: unknown; primitives?: Primitive[] };

const COMPONENT_BYTES: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const TRIANGLES = 4;

const pad4 = (n: number) => Math.ceil(n / 4) * 4;

function parseGlb(bytes: Uint8Array): { json: Json; bin: Uint8Array } | null {
  if (bytes.byteLength < 20) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) return null;
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)).replace(/[\s\0]+$/, '')) as Json;
  const binStart = 20 + jsonLength;
  if (binStart + 8 > bytes.byteLength || view.getUint32(binStart + 4, true) !== 0x004e4942) return null;
  const binLength = view.getUint32(binStart, true);
  return { json, bin: bytes.subarray(binStart + 8, binStart + 8 + binLength) };
}

// An accessor's elements as floats (a normalized integer one scaled to 0-1 or -1-1, as glTF says), null when it can't
// be read safely
function readFloats(json: Json, bin: Uint8Array, index: number, components: number): Float32Array | null {
  const accessor = (json.accessors as Accessor[] | undefined)?.[index];
  if (!accessor || accessor.sparse || TYPE_COMPONENTS[accessor.type] !== components) return null;
  const componentBytes = COMPONENT_BYTES[accessor.componentType];
  if (!componentBytes) return null;
  const out = new Float32Array(accessor.count * components);
  if (accessor.bufferView === undefined) return out; // all zeros
  const bufferView = (json.bufferViews as BufferView[] | undefined)?.[accessor.bufferView];
  if (!bufferView || (bufferView.buffer ?? 0) !== 0) return null;
  const size = components * componentBytes;
  const stride = bufferView.byteStride || size;
  const start = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  if (accessor.count > 0 && start + stride * (accessor.count - 1) + size > bin.byteLength) return null;
  const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const { componentType, normalized } = accessor;
  for (let i = 0; i < accessor.count; i++) {
    for (let k = 0; k < components; k++) {
      const at = start + i * stride + k * componentBytes;
      let v: number;
      switch (componentType) {
        case 5126: v = view.getFloat32(at, true); break;
        case 5120: v = view.getInt8(at); if (normalized) v = Math.max(v / 127, -1); break;
        case 5121: v = view.getUint8(at); if (normalized) v /= 255; break;
        case 5122: v = view.getInt16(at, true); if (normalized) v = Math.max(v / 32767, -1); break;
        case 5123: v = view.getUint16(at, true); if (normalized) v /= 65535; break;
        default: v = view.getUint32(at, true);
      }
      out[i * components + k] = v;
    }
  }
  return out;
}

function readIndices(json: Json, bin: Uint8Array, primitive: Primitive, vertexCount: number): Uint32Array | null {
  if (primitive.indices === undefined) return Uint32Array.from({ length: vertexCount }, (_, i) => i);
  const accessor = (json.accessors as Accessor[] | undefined)?.[primitive.indices];
  if (!accessor || accessor.sparse || accessor.type !== 'SCALAR' || accessor.normalized) return null;
  const values = readFloats(json, bin, primitive.indices, 1);
  if (!values) return null;
  const out = new Uint32Array(values.length);
  for (let i = 0; i < values.length; i++) {
    if (values[i] >= vertexCount) return null;
    out[i] = values[i];
  }
  return out;
}

// Normals from the triangles (area weighted), for parts that have none
function computeNormals(positions: Float32Array, indices: Uint32Array): Float32Array {
  const normals = new Float32Array(positions.length);
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const [a, b, c] = [indices[t] * 3, indices[t + 1] * 3, indices[t + 2] * 3];
    const e1 = [positions[b] - positions[a], positions[b + 1] - positions[a + 1], positions[b + 2] - positions[a + 2]];
    const e2 = [positions[c] - positions[a], positions[c + 1] - positions[a + 1], positions[c + 2] - positions[a + 2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    for (const v of [a, b, c]) for (let k = 0; k < 3; k++) normals[v + k] += n[k];
  }
  return normals;
}

// The 3x3 that turns normals with a node's matrix (its inverse transpose), null when it can't be inverted
function normalMatrix(m: Mat4): number[] | null {
  const [a, b, c, d, e, f, g, h, i] = [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]];
  const det = a * (e * i - f * h) - d * (b * i - c * h) + g * (b * f - c * e);
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  // Columns of the inverse transpose (the cofactors over the determinant)
  return [
    (e * i - f * h) / det, (g * f - d * i) / det, (d * h - g * e) / det,
    (h * c - b * i) / det, (a * i - g * c) / det, (g * b - a * h) / det,
    (b * f - e * c) / det, (d * c - a * f) / det, (a * e - d * b) / det,
  ];
}

// One paint's merged part: positions and normals in the scene's frame, and its triangles
type Group = { material: GltfMaterial; positions: number[]; normals: number[]; indices: number[] };

// A part of the car where it sits in the scene: its primitive, the node's world matrix and every name it goes by
type Placed = { primitive: Primitive; world: Mat4; names: string[] };

export type LiteResult = { bytes: Uint8Array; trianglesBefore: number; trianglesAfter: number; interiorTriangles: number };

export async function liteGlb(bytes: Uint8Array): Promise<LiteResult | null> {
  const parsed = parseGlb(bytes);
  if (!parsed) return null;
  const { json, bin } = parsed;
  await MeshoptSimplifier.ready;

  const nodes = (json.nodes as GltfNode[] | undefined) ?? [];
  const meshes = (json.meshes as GltfMesh[] | undefined) ?? [];
  const materials = (json.materials as GltfMaterial[] | undefined) ?? [];
  const accessors = (json.accessors as Accessor[] | undefined) ?? [];
  const nameOf = (x: { name?: unknown } | undefined) => (typeof x?.name === 'string' ? x.name : '');

  // Every triangle part of the default scene where it sits (as glb.ts measures the bounds)
  const scenes = (json.scenes as { nodes?: number[] }[] | undefined) ?? [];
  const sceneIndex = typeof json.scene === 'number' ? json.scene : 0;
  const roots = scenes[sceneIndex]?.nodes ?? nodes.map((_, i) => i).filter((i) => !nodes.some((n) => n.children?.includes(i)));
  const placed: Placed[] = [];
  const visited = new Set<number>();
  const visit = (index: number, parent: Mat4, names: string[]) => {
    const node = nodes[index];
    if (!node || visited.has(index)) return;
    visited.add(index);
    const local = Array.isArray(node.matrix) && node.matrix.length === 16 ? node.matrix : fromTrs(node.translation, node.rotation, node.scale);
    const world = multiply(parent, local);
    const here = [...names, nameOf(node)];
    if (typeof node.mesh === 'number') {
      const mesh = meshes[node.mesh];
      for (const primitive of mesh?.primitives ?? []) {
        if ((primitive.mode ?? TRIANGLES) !== TRIANGLES || primitive.attributes?.POSITION === undefined) continue;
        const material = primitive.material === undefined ? undefined : materials[primitive.material];
        placed.push({ primitive, world, names: [...here, nameOf(mesh), nameOf(material)] });
      }
    }
    for (const child of node.children ?? []) visit(child, world, here);
  };
  for (const root of roots) visit(root, identity(), []);

  const trianglesOf = (p: Primitive) => Math.floor((accessors[p.indices ?? p.attributes.POSITION]?.count ?? 0) / 3);
  const isInterior = (p: Placed) =>
    p.names.some((name) => name && INTERIOR_PART.test(name)) && !p.names.some((name) => name && LIGHT_PART.test(name));
  const trianglesBefore = placed.reduce((sum, p) => sum + trianglesOf(p.primitive), 0);
  let interiorTriangles = placed.filter(isInterior).reduce((sum, p) => sum + trianglesOf(p.primitive), 0);
  const dropInterior = interiorTriangles <= trianglesBefore * INTERIOR_MAX_SHARE;
  if (!dropInterior) interiorTriangles = 0;
  const parts = dropInterior ? placed.filter((p) => !isInterior(p)) : placed;
  const kept = trianglesBefore - interiorTriangles;
  const keep = Math.min(LITE_LIMITS.keep, kept > 0 ? LITE_LIMITS.maxTriangles / kept : 1);

  const groups = new Map<string, Group>();
  let trianglesAfter = 0;
  for (const { primitive, world } of parts) {
    const vertexCount = accessors[primitive.attributes.POSITION]?.count ?? 0;
    const positions = readFloats(json, bin, primitive.attributes.POSITION, 3);
    if (!positions) return null;
    const normals = primitive.attributes.NORMAL === undefined ? null : readFloats(json, bin, primitive.attributes.NORMAL, 3);
    if (primitive.attributes.NORMAL !== undefined && !normals) return null;
    let indices = readIndices(json, bin, primitive, vertexCount);
    if (!indices) return null;

    // Weld: vertices with the same position and normal become one
    const firstOf = new Map<string, number>();
    const weld = new Uint32Array(vertexCount);
    for (let v = 0; v < vertexCount; v++) {
      const p = v * 3;
      const key = normals
        ? `${positions[p]},${positions[p + 1]},${positions[p + 2]},${normals[p]},${normals[p + 1]},${normals[p + 2]}`
        : `${positions[p]},${positions[p + 1]},${positions[p + 2]}`;
      const first = firstOf.get(key);
      if (first === undefined) firstOf.set(key, v);
      weld[v] = first ?? v;
    }
    const triangles = Math.floor(indices.length / 3);
    indices = indices.slice(0, triangles * 3).map((i) => weld[i]);

    // Simplify a part of some size, in its own frame
    if (triangles >= LITE_LIMITS.minTriangles && keep < 1) {
      const target = Math.max(3, Math.floor(triangles * keep) * 3);
      const [simplified] = MeshoptSimplifier.simplify(indices, positions, 3, target, LITE_LIMITS.targetError, []);
      if (simplified.length >= 3) indices = simplified;
    }
    if (indices.length < 3) continue;
    trianglesAfter += Math.floor(indices.length / 3);
    const vertexNormals = normals ?? computeNormals(positions, indices);

    // Into its paint's group, in the scene's frame
    const material = paintedMaterial(primitive.material === undefined ? {} : materials[primitive.material] ?? {});
    const paint = { ...material };
    delete paint.name;
    const key = JSON.stringify(paint);
    let group = groups.get(key);
    if (!group) {
      group = { material: paint, positions: [], normals: [], indices: [] };
      groups.set(key, group);
    }
    const turn = normalMatrix(world) ?? [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const newIndex = new Map<number, number>();
    for (const v of indices) {
      let n = newIndex.get(v);
      if (n === undefined) {
        n = group.positions.length / 3;
        newIndex.set(v, n);
        const [x, y, z] = [positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]];
        group.positions.push(
          world[0] * x + world[4] * y + world[8] * z + world[12],
          world[1] * x + world[5] * y + world[9] * z + world[13],
          world[2] * x + world[6] * y + world[10] * z + world[14]
        );
        const [nx, ny, nz] = [vertexNormals[v * 3], vertexNormals[v * 3 + 1], vertexNormals[v * 3 + 2]];
        const out = [turn[0] * nx + turn[3] * ny + turn[6] * nz, turn[1] * nx + turn[4] * ny + turn[7] * nz, turn[2] * nx + turn[5] * ny + turn[8] * nz];
        const length = Math.hypot(out[0], out[1], out[2]) || 1;
        group.normals.push(out[0] / length, out[1] / length, out[2] / length);
      }
      group.indices.push(n);
    }
  }
  if (groups.size === 0) return null;

  // The output: one node, one mesh, a primitive per paint
  const chunks: Uint8Array[] = [];
  let length = 0;
  const bufferViews: Json[] = [];
  const outAccessors: Json[] = [];
  const addView = (data: Uint8Array, target: number) => {
    bufferViews.push({ buffer: 0, byteOffset: length, byteLength: data.byteLength, target });
    chunks.push(data);
    length += data.byteLength;
    const tail = pad4(length) - length;
    if (tail) {
      chunks.push(new Uint8Array(tail));
      length += tail;
    }
    return bufferViews.length - 1;
  };
  const addAccessor = (accessor: Json) => outAccessors.push(accessor) - 1;
  const outMaterials: GltfMaterial[] = [];
  const primitives: Primitive[] = [];
  for (const group of groups.values()) {
    const positions = new Float32Array(group.positions);
    const count = positions.length / 3;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positions.length; i++) {
      min[i % 3] = Math.min(min[i % 3], positions[i]);
      max[i % 3] = Math.max(max[i % 3], positions[i]);
    }
    const normals = new Float32Array(group.normals);
    const small = count <= 65535;
    const indices = small ? new Uint16Array(group.indices) : new Uint32Array(group.indices);
    const POSITION = addAccessor({ bufferView: addView(new Uint8Array(positions.buffer), 34962), componentType: 5126, count, type: 'VEC3', min, max });
    const NORMAL = addAccessor({ bufferView: addView(new Uint8Array(normals.buffer), 34962), componentType: 5126, count, type: 'VEC3' });
    const index = addAccessor({
      bufferView: addView(new Uint8Array(indices.buffer), 34963),
      componentType: small ? 5123 : 5125,
      count: indices.length,
      type: 'SCALAR',
    });
    // Named so the browser's repaint (deckModel.ts, which goes by name first) keeps each paint's shade
    const shade = (group.material.pbrMetallicRoughness?.baseColorFactor as number[] | undefined)?.[0];
    outMaterials.push({ name: `${shade === DARK_SHADE ? 'black' : 'body'}-${outMaterials.length}`, ...group.material });
    primitives.push({ attributes: { POSITION, NORMAL }, indices: index, material: outMaterials.length - 1 });
  }
  const binary = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    binary.set(chunk, at);
    at += chunk.byteLength;
  }

  const asset = (json.asset ?? {}) as Json;
  const out: Json = {
    asset: {
      ...asset,
      generator: `${typeof asset.generator === 'string' ? `${asset.generator.slice(0, 150)}; ` : ''}RacingCoach lite ${LITE_VERSION}`,
    },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'car', mesh: 0 }],
    meshes: [{ name: 'car', primitives }],
    materials: outMaterials,
    accessors: outAccessors,
    bufferViews,
    buffers: [{ byteLength: binary.byteLength }],
  };
  return { bytes: buildGlb(out, binary), trianglesBefore, trianglesAfter, interiorTriangles };
}
