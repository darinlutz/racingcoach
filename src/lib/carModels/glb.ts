// Checking an uploaded GLB before it's stored (docs/car-models.md). Pure, no I/O: reads the binary glTF's header and
// JSON chunk, refuses what the site won't serve, and measures the model (bounds from its accessors' min/max through the
// default scene's node transforms, triangles, textures) so the Admin page can normalize it without the browser having
// to load it first.
//
// Refused: anything that isn't glTF 2.0 binary; a buffer or image that points outside the file (an http URL or another
// file), so a model can never make a viewer's browser fetch from elsewhere; extensions that need a decoder the site
// doesn't host (Draco, meshopt, Basis), as the CSP and the loaders would have to fetch them from a CDN; and models over
// the size and triangle limits. Animations and skins are allowed but never played.

import { fromTrs, multiply, identity, transformBounds, type Bounds, type Mat4, type Vec3 } from './matrix.ts';

export const GLB_LIMITS = {
  bytes: 40 * 1024 * 1024,
  jsonBytes: 8 * 1024 * 1024,
  triangles: 1_500_000,
  // Above this the model is accepted with a warning: Lap Compare draws two of them every frame
  trianglesWarning: 400_000,
  nodes: 20_000,
} as const;

// Required extensions three.js and loaders.gl both handle without fetching anything
const ALLOWED_REQUIRED = new Set(['KHR_materials_unlit', 'KHR_texture_transform', 'KHR_materials_emissive_strength']);
const NEEDS_DECODER = new Set(['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_texture_basisu', 'KHR_meshopt_compression']);
const IMAGE_DATA_URI = /^data:image\/(png|jpeg|webp);base64,/;

export type GlbProblem =
  | { code: 'tooLarge' }
  | { code: 'notGlb' }
  | { code: 'version'; detail: string }
  | { code: 'malformed'; detail: string }
  | { code: 'externalResource'; detail: string }
  | { code: 'needsDecoder'; detail: string }
  | { code: 'unsupportedExtension'; detail: string }
  | { code: 'noGeometry' }
  | { code: 'tooManyTriangles'; detail: string };

export type GlbWarning =
  | { code: 'manyTriangles'; detail: string }
  | { code: 'animations' }
  | { code: 'skins' }
  | { code: 'cameras' }
  | { code: 'lights' }
  | { code: 'unknownExtension'; detail: string };

export type GlbStats = { triangles: number; meshes: number; primitives: number; nodes: number; materials: number; textures: number; images: number };
export type GlbInfo = { bounds: Bounds; stats: GlbStats; generator: string; warnings: GlbWarning[] };
export type GlbCheck = { ok: true; info: GlbInfo } | { ok: false; problems: GlbProblem[] };

type Json = Record<string, unknown>;
type GltfNode = { children?: number[]; mesh?: number; matrix?: number[]; translation?: Vec3; rotation?: [number, number, number, number]; scale?: Vec3 };
type Accessor = { count?: number; min?: number[]; max?: number[]; normalized?: boolean };
type Primitive = { attributes?: Record<string, number>; indices?: number; mode?: number };

const GLB_MAGIC = 0x46546c67; // 'glTF'
const JSON_CHUNK = 0x4e4f534a; // 'JSON'
const BIN_CHUNK = 0x004e4942; // 'BIN\0'

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

export function checkGlb(bytes: Uint8Array): GlbCheck {
  const fail = (...problems: GlbProblem[]): GlbCheck => ({ ok: false, problems });
  if (bytes.byteLength > GLB_LIMITS.bytes) return fail({ code: 'tooLarge' });
  if (bytes.byteLength < 20) return fail({ code: 'notGlb' });
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC) return fail({ code: 'notGlb' });
  const version = view.getUint32(4, true);
  if (version !== 2) return fail({ code: 'version', detail: String(version) });
  const length = view.getUint32(8, true);
  if (length !== bytes.byteLength) return fail({ code: 'malformed', detail: 'length' });
  const jsonLength = view.getUint32(12, true);
  if (view.getUint32(16, true) !== JSON_CHUNK || jsonLength === 0 || jsonLength > GLB_LIMITS.jsonBytes || 20 + jsonLength > length) {
    return fail({ code: 'malformed', detail: 'json chunk' });
  }
  let json: Json;
  try {
    json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(20, 20 + jsonLength)).replace(/[\s\0]+$/, '')) as Json;
  } catch {
    return fail({ code: 'malformed', detail: 'json' });
  }
  if (!json || typeof json !== 'object') return fail({ code: 'malformed', detail: 'json' });
  const asset = (json.asset ?? {}) as Json;
  if (typeof asset.version !== 'string' || !asset.version.startsWith('2.')) return fail({ code: 'version', detail: String(asset.version) });

  // The binary chunk, when there is one, must follow the JSON chunk
  let binLength = 0;
  const binStart = 20 + jsonLength;
  if (binStart + 8 <= length) {
    binLength = view.getUint32(binStart, true);
    if (view.getUint32(binStart + 4, true) !== BIN_CHUNK || binStart + 8 + binLength > length) return fail({ code: 'malformed', detail: 'bin chunk' });
  }

  const problems: GlbProblem[] = [];
  const warnings: GlbWarning[] = [];
  const buffers = arr<{ uri?: unknown; byteLength?: number }>(json.buffers);
  buffers.forEach((buffer, i) => {
    // Only the GLB's own binary chunk: no URI at all (glTF's rule for it). A data: buffer is refused too, as it
    // makes the file far larger for nothing
    if (buffer.uri !== undefined) problems.push({ code: 'externalResource', detail: `buffer ${i}` });
    else if (i !== 0) problems.push({ code: 'malformed', detail: `buffer ${i} has no uri` });
    else if (typeof buffer.byteLength === 'number' && buffer.byteLength > binLength) problems.push({ code: 'malformed', detail: 'buffer 0 is longer than the bin chunk' });
  });
  arr<{ uri?: unknown }>(json.images).forEach((image, i) => {
    if (image.uri !== undefined && !(typeof image.uri === 'string' && IMAGE_DATA_URI.test(image.uri))) {
      problems.push({ code: 'externalResource', detail: `image ${i}` });
    }
  });
  for (const ext of arr<string>(json.extensionsRequired)) {
    if (NEEDS_DECODER.has(ext)) problems.push({ code: 'needsDecoder', detail: ext });
    else if (!ALLOWED_REQUIRED.has(ext)) problems.push({ code: 'unsupportedExtension', detail: ext });
  }
  for (const ext of arr<string>(json.extensionsUsed)) {
    if (NEEDS_DECODER.has(ext) && !arr<string>(json.extensionsRequired).includes(ext)) problems.push({ code: 'needsDecoder', detail: ext });
    else if (!ext.startsWith('KHR_materials_') && !ALLOWED_REQUIRED.has(ext) && !NEEDS_DECODER.has(ext) && ext !== 'KHR_lights_punctual') {
      warnings.push({ code: 'unknownExtension', detail: ext });
    }
  }

  const nodes = arr<GltfNode>(json.nodes);
  const meshes = arr<{ primitives?: Primitive[] }>(json.meshes);
  const accessors = arr<Accessor>(json.accessors);
  if (nodes.length > GLB_LIMITS.nodes) problems.push({ code: 'malformed', detail: 'too many nodes' });

  let triangles = 0;
  let primitives = 0;
  for (const mesh of meshes) {
    for (const p of arr<Primitive>(mesh.primitives)) {
      primitives++;
      const mode = p.mode ?? 4;
      const count = p.indices !== undefined ? accessors[p.indices]?.count : accessors[p.attributes?.POSITION ?? -1]?.count;
      if (typeof count !== 'number') continue;
      if (mode === 4) triangles += Math.floor(count / 3);
      else if (mode === 5 || mode === 6) triangles += Math.max(0, count - 2);
    }
  }
  if (triangles > GLB_LIMITS.triangles) problems.push({ code: 'tooManyTriangles', detail: String(triangles) });
  else if (triangles > GLB_LIMITS.trianglesWarning) warnings.push({ code: 'manyTriangles', detail: String(triangles) });

  // The bounds: every mesh of the default scene, its POSITION accessor's box (glTF requires min and max on it) taken
  // through the node's world matrix. A quantized (normalized) POSITION is left out, as its min/max aren't meters
  const scenes = arr<{ nodes?: number[] }>(json.scenes);
  const sceneIndex = typeof json.scene === 'number' ? json.scene : 0;
  const roots = scenes[sceneIndex]?.nodes ?? nodes.map((_, i) => i).filter((i) => !nodes.some((n) => n.children?.includes(i)));
  let bounds: Bounds | null = null;
  const visited = new Set<number>();
  const visit = (index: number, parent: Mat4) => {
    const node = nodes[index];
    if (!node || visited.has(index)) return;
    visited.add(index);
    const local = Array.isArray(node.matrix) && node.matrix.length === 16 ? node.matrix : fromTrs(node.translation, node.rotation, node.scale);
    const world = multiply(parent, local);
    if (typeof node.mesh === 'number') {
      for (const p of arr<Primitive>(meshes[node.mesh]?.primitives)) {
        const a = accessors[p.attributes?.POSITION ?? -1];
        if (!a || a.normalized || a.min?.length !== 3 || a.max?.length !== 3) continue;
        const box = transformBounds(world, { min: a.min as Vec3, max: a.max as Vec3 });
        bounds = bounds
          ? { min: bounds.min.map((v, k) => Math.min(v, box.min[k])) as Vec3, max: bounds.max.map((v, k) => Math.max(v, box.max[k])) as Vec3 }
          : box;
      }
    }
    for (const child of node.children ?? []) visit(child, world);
  };
  for (const root of roots) visit(root, identity());
  const measured = bounds as Bounds | null;
  if (!measured || measured.min.some((v, k) => !Number.isFinite(v) || !Number.isFinite(measured.max[k]) || measured.max[k] - v <= 0)) {
    if (!problems.some((p) => p.code === 'tooManyTriangles')) problems.push({ code: 'noGeometry' });
  }
  if (problems.length) return { ok: false, problems };

  if (arr(json.animations).length) warnings.push({ code: 'animations' });
  if (arr(json.skins).length) warnings.push({ code: 'skins' });
  if (arr(json.cameras).length) warnings.push({ code: 'cameras' });
  if (arr<string>(json.extensionsUsed).includes('KHR_lights_punctual')) warnings.push({ code: 'lights' });

  return {
    ok: true,
    info: {
      bounds: measured!,
      stats: {
        triangles,
        meshes: meshes.length,
        primitives,
        nodes: nodes.length,
        materials: arr(json.materials).length,
        textures: arr(json.textures).length,
        images: arr(json.images).length,
      },
      generator: typeof asset.generator === 'string' ? asset.generator.slice(0, 200) : '',
      warnings,
    },
  };
}

// The two GLB chunks put together, for tests and fixtures: the JSON padded with spaces and the binary with zeros to
// four bytes, as the format requires
export function buildGlb(json: object, bin?: Uint8Array): Uint8Array {
  const text = new TextEncoder().encode(JSON.stringify(json));
  const jsonPadded = new Uint8Array(Math.ceil(text.length / 4) * 4).fill(0x20);
  jsonPadded.set(text);
  const binPadded = bin ? new Uint8Array(Math.ceil(bin.length / 4) * 4) : null;
  if (bin && binPadded) binPadded.set(bin);
  const total = 12 + 8 + jsonPadded.length + (binPadded ? 8 + binPadded.length : 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonPadded.length, true);
  view.setUint32(16, JSON_CHUNK, true);
  out.set(jsonPadded, 20);
  if (binPadded) {
    const at = 20 + jsonPadded.length;
    view.setUint32(at, binPadded.length, true);
    view.setUint32(at + 4, BIN_CHUNK, true);
    out.set(binPadded, at + 8);
  }
  return out;
}
