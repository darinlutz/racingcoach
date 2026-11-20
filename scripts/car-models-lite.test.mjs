// Lap Compare's lighter, repainted copy of a car's 3D model (docs/car-models.md): npm run test:car-models
//
// glbLite.ts drops textures and texture coordinates, welds and simplifies a little and stays a valid GLB of the same
// size; modelPaint.ts paints every material grey for the lap's color; Lap Compare asks for the copy.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildGlb, checkGlb } from '../src/lib/carModels/glb.ts';
import { liteGlb, LITE_VERSION } from '../src/lib/carModels/glbLite.ts';
import { liteKeyOf } from '../src/lib/carModels/carModelLite.ts';
import { BODY_SHADE, DARK_SHADE, paintInPlace, paintShade, paintedMaterial } from '../src/lib/carModels/modelPaint.ts';
import { liteModelUrl } from '../src/lib/carModels/modelRules.ts';
import { testCarGlb } from './testCarGlb.mjs';

const close = (a, b, eps) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < eps, `${a} vs ${b}`));

// A UV sphere with a texture seam (its first and last columns are separate vertices at the same place, as texture
// coordinates split them), a texture coordinate per vertex and an embedded image
function texturedSphereGlb(rings = 60, segments = 90) {
  const positions = [];
  const normals = [];
  const uvs = [];
  for (let r = 0; r <= rings; r++) {
    for (let s = 0; s <= segments; s++) {
      const [theta, phi] = [(r / rings) * Math.PI, (s / segments) * Math.PI * 2];
      const n = [Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi)];
      positions.push(...n.map((v) => v * 1.2));
      normals.push(...n);
      uvs.push(s / segments, r / rings);
    }
  }
  const indices = [];
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segments; s++) {
      const a = r * (segments + 1) + s;
      const b = a + segments + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const image = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
  const parts = [new Float32Array(positions), new Float32Array(normals), new Float32Array(uvs), new Uint32Array(indices), image];
  const bufferViews = [];
  let offset = 0;
  const bin = new Uint8Array(parts.reduce((sum, p) => sum + Math.ceil(p.byteLength / 4) * 4, 0));
  for (const p of parts) {
    bin.set(new Uint8Array(p.buffer, p.byteOffset, p.byteLength), offset);
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: p.byteLength });
    offset += Math.ceil(p.byteLength / 4) * 4;
  }
  const count = positions.length / 3;
  return buildGlb(
    {
      asset: { version: '2.0' },
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0 }] }],
      materials: [
        { name: 'Paint', pbrMetallicRoughness: { baseColorFactor: [1, 0.85, 0, 1], baseColorTexture: { index: 0 } }, emissiveFactor: [1, 1, 0] },
        { name: 'Tyre_rubber', pbrMetallicRoughness: { baseColorFactor: [0.5, 0.5, 0.5, 1] } },
      ],
      textures: [{ source: 0 }],
      images: [{ bufferView: 4, mimeType: 'image/png' }],
      extensionsUsed: ['KHR_texture_transform', 'KHR_materials_clearcoat'],
      accessors: [
        { bufferView: 0, componentType: 5126, count, type: 'VEC3', min: [-1.2, -1.2, -1.2], max: [1.2, 1.2, 1.2] },
        { bufferView: 1, componentType: 5126, count, type: 'VEC3' },
        { bufferView: 2, componentType: 5126, count, type: 'VEC2' },
        { bufferView: 3, componentType: 5125, count: indices.length, type: 'SCALAR' },
      ],
      bufferViews,
      buffers: [{ byteLength: bin.length }],
    },
    bin
  );
}

const glbJson = (bytes) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + view.getUint32(12, true))));
};

describe('Lap Compare’s lighter copy of a model', () => {
  test('drops textures and texture coordinates, simplifies a little, and stays a valid GLB of the same size', async () => {
    const original = texturedSphereGlb();
    const lite = await liteGlb(original);
    assert.ok(lite);
    const check = checkGlb(lite.bytes);
    assert.ok(check.ok, JSON.stringify(check));
    assert.equal(check.info.stats.textures, 0);
    assert.equal(check.info.stats.images, 0);
    const { trianglesBefore: before, trianglesAfter: after } = lite;
    assert.ok(after < before * 0.7 && after > before * 0.3, `${before} -> ${after}`);
    assert.ok(lite.bytes.byteLength < original.byteLength * 0.6, `${original.byteLength} -> ${lite.bytes.byteLength}`);
    close(check.info.bounds.min, [-1.2, -1.2, -1.2], 0.02);
    close(check.info.bounds.max, [1.2, 1.2, 1.2], 0.02);
    const json = glbJson(lite.bytes);
    assert.deepEqual(Object.keys(json.meshes[0].primitives[0].attributes).sort(), ['NORMAL', 'POSITION']);
    assert.equal(json.extensionsUsed, undefined);
    assert.deepEqual(json.materials[0].pbrMetallicRoughness.baseColorFactor, [1, 1, 1, 1]);
    assert.equal(json.materials[0].emissiveFactor, undefined);
    assert.deepEqual(json.materials[1].pbrMetallicRoughness.baseColorFactor, [DARK_SHADE, DARK_SHADE, DARK_SHADE, 1]);
  });

  test('leaves small meshes whole and keeps the test car valid, its bounds unchanged', async () => {
    const lite = await liteGlb(testCarGlb());
    assert.ok(lite);
    assert.equal(lite.trianglesAfter, lite.trianglesBefore);
    const check = checkGlb(lite.bytes);
    assert.ok(check.ok);
    const before = checkGlb(testCarGlb()).info.bounds;
    close(check.info.bounds.min, before.min, 1e-6);
    close(check.info.bounds.max, before.max, 1e-6);
  });

  test('paints every material grey for the lap color: bodywork white, dark parts dark, glass still see-through', () => {
    assert.equal(paintShade({ name: 'Body', pbrMetallicRoughness: { baseColorFactor: [1, 0.9, 0, 1] } }), BODY_SHADE);
    assert.equal(paintShade({ name: 'Windscreen' }), DARK_SHADE);
    assert.equal(paintShade({ name: 'trim', pbrMetallicRoughness: { baseColorFactor: [0.02, 0.02, 0.02, 1] } }), DARK_SHADE);
    const glass = paintedMaterial({
      name: 'glass',
      alphaMode: 'BLEND',
      pbrMetallicRoughness: { baseColorFactor: [0.2, 0.2, 0.2, 0.3], baseColorTexture: { index: 1 } },
    });
    assert.equal(glass.alphaMode, 'BLEND');
    assert.equal(glass.pbrMetallicRoughness.baseColorFactor[3], 0.3);
    assert.equal(glass.pbrMetallicRoughness.baseColorTexture, undefined);
    const loaded = { id: 'm0', name: 'Paint', pbrMetallicRoughness: { baseColorTexture: { texture: {} } }, normalTexture: {}, extensions: {} };
    paintInPlace(loaded);
    assert.deepEqual(Object.keys(loaded).sort(), ['id', 'name', 'pbrMetallicRoughness']);
  });

  test('Lap Compare asks for the lighter copy, and it is kept apart from the original', () => {
    assert.equal(liteModelUrl('/api/car-models/3/file?v=abc'), '/api/car-models/3/file?v=abc&lite=1');
    assert.match(readFileSync('src/components/TrackLineMap3D.tsx', 'utf8'), /useDeckModel\(model \? liteModelUrl\(model\.url\) : null\)/);
    assert.match(readFileSync('src/app/api/car-models/[id]/file/route.ts', 'utf8'), /\$\{lite \? '-lite' : ''\}/);
    assert.equal(liteKeyOf('car-models/4/abc.glb'), `car-models/4/abc.lite${LITE_VERSION}.glb`);
    assert.match(readFileSync('src/lib/carModels/deckModel.ts', 'utf8'), /loadImages: false/);
  });
});
