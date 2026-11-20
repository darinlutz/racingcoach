// Lap Compare's lighter copy of a car's GLB (docs/car-models.md). The 3D view draws only the model's shape, in its lap's
// color (modelPaint.ts), so everything else is left out of what it downloads: textures, images, texture coordinates,
// vertex colors, tangents, skins, morph targets and animations. Each triangle mesh's vertices are welded (vertices
// split only by texture seams become one again) and the mesh simplified a little with meshoptimizer's simplifier, to
// LITE_LIMITS.keep of its triangles (less when the model is very dense) within a small error, never emptied. The
// materials are repainted. No I/O; the file route (carModelLite.ts) keeps the result beside the original.
//
// It returns null for a file it can't rewrite safely (sparse accessors, a missing binary chunk), and the route then
// sends the original, which the browser repaints itself (deckModel.ts).

import { MeshoptSimplifier } from 'meshoptimizer';
import { buildGlb } from './glb.ts';
import { paintedMaterial, type GltfMaterial } from './modelPaint.ts';

// Bump when the output changes, so stored copies are made again
export const LITE_VERSION = 1;
export const LITE_LIMITS = {
  // Share of each mesh's triangles kept
  keep: 0.6,
  // The whole car's triangles at most (two cars are drawn every frame)
  maxTriangles: 300_000,
  // How far (a share of each mesh's size) the simplified surface may move
  targetError: 0.004,
  // Meshes this small are left alone
  minTriangles: 48,
} as const;

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
type Primitive = { attributes: Record<string, number>; indices?: number; mode?: number; material?: number; targets?: unknown; extensions?: unknown };

const COMPONENT_BYTES: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const FLOAT = 5126;
const KEPT_ATTRIBUTES = ['POSITION', 'NORMAL'] as const;
const TRIANGLES = 4;
const DROPPED_EXTENSION = /^(KHR_materials_|KHR_texture_|EXT_texture_)/;

const pad4 = (n: number) => Math.ceil(n / 4) * 4;

// An attribute's elements, tightly packed
type Column = { accessor: Accessor; size: number; data: Uint8Array };

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

function readColumn(json: Json, bin: Uint8Array, index: number): Column | null {
  const accessor = (json.accessors as Accessor[] | undefined)?.[index];
  if (!accessor || accessor.sparse) return null;
  const components = TYPE_COMPONENTS[accessor.type];
  const componentBytes = COMPONENT_BYTES[accessor.componentType];
  if (!components || !componentBytes || accessor.type.startsWith('MAT')) return null;
  const size = components * componentBytes;
  const data = new Uint8Array(accessor.count * size);
  if (accessor.bufferView === undefined) return { accessor, size, data }; // all zeros, as glTF says
  const bufferView = (json.bufferViews as BufferView[] | undefined)?.[accessor.bufferView];
  if (!bufferView || (bufferView.buffer ?? 0) !== 0) return null;
  const stride = bufferView.byteStride || size;
  const start = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  if (accessor.count > 0 && start + stride * (accessor.count - 1) + size > bin.byteLength) return null;
  for (let i = 0; i < accessor.count; i++) data.set(bin.subarray(start + i * stride, start + i * stride + size), i * size);
  return { accessor, size, data };
}

function readIndices(json: Json, bin: Uint8Array, primitive: Primitive, vertexCount: number): Uint32Array | null {
  if (primitive.indices === undefined) return Uint32Array.from({ length: vertexCount }, (_, i) => i);
  const column = readColumn(json, bin, primitive.indices);
  if (!column || column.accessor.type !== 'SCALAR') return null;
  const { componentType, count } = column.accessor;
  const view = new DataView(column.data.buffer, column.data.byteOffset, column.data.byteLength);
  const out = new Uint32Array(count);
  for (let i = 0; i < count; i++) {
    out[i] = componentType === 5121 ? view.getUint8(i) : componentType === 5123 ? view.getUint16(i * 2, true) : view.getUint32(i * 4, true);
    if (out[i] >= vertexCount) return null;
  }
  return out;
}

// The output's binary chunk and its views and accessors
class Writer {
  chunks: Uint8Array[] = [];
  length = 0;
  bufferViews: Json[] = [];
  accessors: Json[] = [];

  private view(data: Uint8Array, target: number, stride?: number) {
    const byteOffset = this.length;
    this.chunks.push(data);
    this.length += data.byteLength;
    const tail = pad4(this.length) - this.length;
    if (tail) {
      this.chunks.push(new Uint8Array(tail));
      this.length += tail;
    }
    this.bufferViews.push({ buffer: 0, byteOffset, byteLength: data.byteLength, target, ...(stride ? { byteStride: stride } : {}) });
    return this.bufferViews.length - 1;
  }

  // A vertex attribute, its elements padded to 4 bytes as glTF requires
  attribute(column: Column, order: Uint32Array, minMax?: { min: number[]; max: number[] }) {
    const stride = pad4(column.size);
    const data = new Uint8Array(order.length * stride);
    order.forEach((v, i) => data.set(column.data.subarray(v * column.size, (v + 1) * column.size), i * stride));
    const { componentType, normalized, type } = column.accessor;
    const bufferView = this.view(data, 34962, stride);
    this.accessors.push({
      bufferView,
      componentType,
      ...(normalized ? { normalized: true } : {}),
      count: order.length,
      type,
      ...(minMax ?? {}),
    });
    return this.accessors.length - 1;
  }

  indices(indices: Uint32Array, vertexCount: number) {
    const small = vertexCount <= 65535;
    const data = small ? new Uint16Array(indices) : indices;
    const bufferView = this.view(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), 34963);
    this.accessors.push({ bufferView, componentType: small ? 5123 : 5125, count: indices.length, type: 'SCALAR' });
    return this.accessors.length - 1;
  }

  bin() {
    const out = new Uint8Array(this.length);
    let at = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, at);
      at += chunk.byteLength;
    }
    return out;
  }
}

function floatMinMax(column: Column, order: Uint32Array) {
  const n = TYPE_COMPONENTS[column.accessor.type];
  const view = new DataView(column.data.buffer, column.data.byteOffset, column.data.byteLength);
  const min = new Array(n).fill(Infinity);
  const max = new Array(n).fill(-Infinity);
  for (const v of order) {
    for (let k = 0; k < n; k++) {
      const x = view.getFloat32(v * column.size + k * 4, true);
      if (x < min[k]) min[k] = x;
      if (x > max[k]) max[k] = x;
    }
  }
  return { min, max };
}

export type LiteResult = { bytes: Uint8Array; trianglesBefore: number; trianglesAfter: number };

export async function liteGlb(bytes: Uint8Array): Promise<LiteResult | null> {
  const parsed = parseGlb(bytes);
  if (!parsed) return null;
  const { json, bin } = parsed;
  await MeshoptSimplifier.ready;

  const meshes = (json.meshes as { primitives?: Primitive[]; weights?: unknown }[] | undefined) ?? [];
  // Every triangle the model has, to keep the whole car under maxTriangles
  let trianglesBefore = 0;
  for (const mesh of meshes) {
    for (const p of mesh.primitives ?? []) {
      if ((p.mode ?? TRIANGLES) !== TRIANGLES) continue;
      const count = (json.accessors as Accessor[])[p.indices ?? p.attributes?.POSITION]?.count ?? 0;
      trianglesBefore += Math.floor(count / 3);
    }
  }
  const keep = Math.min(LITE_LIMITS.keep, trianglesBefore > 0 ? LITE_LIMITS.maxTriangles / trianglesBefore : 1);

  const writer = new Writer();
  let trianglesAfter = 0;
  for (const mesh of meshes) {
    delete mesh.weights;
    const primitives: Primitive[] = [];
    for (const primitive of mesh.primitives ?? []) {
      if (primitive.attributes?.POSITION === undefined) continue;
      const columns = KEPT_ATTRIBUTES.map((name) =>
        primitive.attributes[name] === undefined ? null : readColumn(json, bin, primitive.attributes[name])
      );
      const position = columns[0];
      if (!position) return null;
      if (primitive.attributes.NORMAL !== undefined && !columns[1]) return null;
      const vertexCount = position.accessor.count;
      let indices = readIndices(json, bin, primitive, vertexCount);
      if (!indices) return null;
      const mode = primitive.mode ?? TRIANGLES;

      // Weld: vertices with the same position and normal become one
      const kept = columns.filter((c): c is Column => c !== null);
      const firstOf = new Map<string, number>();
      const weld = new Uint32Array(vertexCount);
      for (let v = 0; v < vertexCount; v++) {
        let key = '';
        for (const c of kept) {
          const slice = c.data.subarray(v * c.size, (v + 1) * c.size);
          for (let b = 0; b < slice.length; b++) key += String.fromCharCode(slice[b]);
        }
        const first = firstOf.get(key);
        if (first === undefined) firstOf.set(key, v);
        weld[v] = first ?? v;
      }
      indices = indices.map((i) => weld[i]);

      // Simplify a float triangle mesh of some size
      const triangles = Math.floor(indices.length / 3);
      const floatPositions = position.accessor.componentType === FLOAT && !position.accessor.normalized && position.accessor.type === 'VEC3';
      if (mode === TRIANGLES && floatPositions && triangles >= LITE_LIMITS.minTriangles && keep < 1) {
        const positions = new Float32Array(position.data.buffer.slice(position.data.byteOffset, position.data.byteOffset + position.data.byteLength));
        const target = Math.max(3, Math.floor(triangles * keep) * 3);
        const [simplified] = MeshoptSimplifier.simplify(indices.slice(0, triangles * 3), positions, 3, target, LITE_LIMITS.targetError, []);
        if (simplified.length >= 3) indices = simplified;
      }
      if (mode === TRIANGLES) trianglesAfter += Math.floor(indices.length / 3);

      // Compact: only the vertices still used, in the order they're first used
      const newIndex = new Map<number, number>();
      const order: number[] = [];
      const remapped = new Uint32Array(indices.length);
      indices.forEach((v, i) => {
        let n = newIndex.get(v);
        if (n === undefined) {
          n = order.length;
          newIndex.set(v, n);
          order.push(v);
        }
        remapped[i] = n;
      });
      const vertices = Uint32Array.from(order);
      const attributes: Record<string, number> = {
        POSITION: writer.attribute(
          position,
          vertices,
          floatPositions ? floatMinMax(position, vertices) : { min: position.accessor.min ?? [], max: position.accessor.max ?? [] }
        ),
      };
      if (columns[1]) attributes.NORMAL = writer.attribute(columns[1], vertices);
      const out: Primitive = { attributes, indices: writer.indices(remapped, vertices.length) };
      if (mode !== TRIANGLES) out.mode = mode;
      if (primitive.material !== undefined) out.material = primitive.material;
      primitives.push(out);
    }
    mesh.primitives = primitives;
  }

  json.materials = ((json.materials as GltfMaterial[] | undefined) ?? []).map(paintedMaterial);
  for (const key of ['images', 'textures', 'samplers', 'animations', 'skins']) delete json[key];
  for (const node of (json.nodes as Json[] | undefined) ?? []) {
    delete node.skin;
    delete node.weights;
  }
  for (const key of ['extensionsUsed', 'extensionsRequired']) {
    const list = ((json[key] as string[] | undefined) ?? []).filter((ext) => !DROPPED_EXTENSION.test(ext));
    if (list.length) json[key] = list;
    else delete json[key];
  }
  const binary = writer.bin();
  json.accessors = writer.accessors;
  json.bufferViews = writer.bufferViews;
  json.buffers = [{ byteLength: binary.byteLength }];
  const asset = (json.asset ?? {}) as Json;
  json.asset = { ...asset, generator: `${typeof asset.generator === 'string' ? `${asset.generator.slice(0, 150)}; ` : ''}RacingCoach lite ${LITE_VERSION}` };
  return { bytes: buildGlb(json, binary), trianglesBefore, trianglesAfter };
}
