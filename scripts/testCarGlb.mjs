// A small test car as a GLB, for the 3D car models' tests and for trying the Admin page's upload locally
// (docs/car-models.md): a body box, a cabin box and four wheel boxes, in glTF's own convention (+Y up) facing +Z, in
// meters, the body 4.6 m long, 2.0 m wide, its wheels 2.7 m apart on a 1.66 m track. Its parts are separate nodes, some
// moved by a node translation, so the bounds measurement has to follow the scene's transforms.
//
//   node scripts/testCarGlb.mjs out.glb     writes the file
//   import { testCarGlb } from './testCarGlb.mjs'

import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { buildGlb } from '../src/lib/carModels/glb.ts';

// A box's 24 vertices (4 per face, so each face has its own normal) and 36 indices
function box([sx, sy, sz]) {
  const [x, y, z] = [sx / 2, sy / 2, sz / 2];
  const faces = [
    [[1, 0, 0], [[x, -y, -z], [x, y, -z], [x, y, z], [x, -y, z]]],
    [[-1, 0, 0], [[-x, -y, z], [-x, y, z], [-x, y, -z], [-x, -y, -z]]],
    [[0, 1, 0], [[-x, y, -z], [-x, y, z], [x, y, z], [x, y, -z]]],
    [[0, -1, 0], [[-x, -y, z], [-x, -y, -z], [x, -y, -z], [x, -y, z]]],
    [[0, 0, 1], [[-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]]],
    [[0, 0, -1], [[x, -y, -z], [-x, -y, -z], [-x, y, -z], [x, y, -z]]],
  ];
  const positions = [];
  const normals = [];
  const indices = [];
  faces.forEach(([n, corners], f) => {
    for (const c of corners) {
      positions.push(...c);
      normals.push(...n);
    }
    const o = f * 4;
    indices.push(o, o + 1, o + 2, o, o + 2, o + 3);
  });
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint16Array(indices), half: [x, y, z] };
}

export function testCarGlb() {
  const parts = [
    { name: 'body', size: [2.0, 0.7, 4.6], at: [0, 0.6, 0], color: [0.85, 0.12, 0.1, 1] },
    { name: 'cabin', size: [1.5, 0.45, 1.8], at: [0, 1.17, -0.3], color: [0.1, 0.1, 0.12, 1] },
    ...[
      ['LF', 0.83, 1.35],
      ['RF', -0.83, 1.35],
      ['LR', 0.83, -1.35],
      ['RR', -0.83, -1.35],
    ].map(([name, x, z]) => ({ name: `wheel_${name}`, size: [0.3, 0.68, 0.68], at: [x, 0.34, z], color: [0.05, 0.05, 0.05, 1] })),
  ];
  const chunks = [];
  let offset = 0;
  const bufferViews = [];
  const accessors = [];
  const meshes = [];
  const nodes = [];
  const materials = [];
  parts.forEach((part, i) => {
    const b = box(part.size);
    const add = (array, target) => {
      const bytes = new Uint8Array(array.buffer.slice(0));
      const padded = Math.ceil(bytes.length / 4) * 4;
      const out = new Uint8Array(padded);
      out.set(bytes);
      chunks.push(out);
      bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target });
      offset += padded;
      return bufferViews.length - 1;
    };
    const pv = add(b.positions, 34962);
    const nv = add(b.normals, 34962);
    const iv = add(b.indices, 34963);
    accessors.push({ bufferView: pv, componentType: 5126, count: 24, type: 'VEC3', min: b.half.map((h) => -h), max: b.half });
    accessors.push({ bufferView: nv, componentType: 5126, count: 24, type: 'VEC3' });
    accessors.push({ bufferView: iv, componentType: 5123, count: 36, type: 'SCALAR' });
    materials.push({ name: part.name, pbrMetallicRoughness: { baseColorFactor: part.color, metallicFactor: 0.2, roughnessFactor: 0.5 } });
    meshes.push({ name: part.name, primitives: [{ attributes: { POSITION: i * 3, NORMAL: i * 3 + 1 }, indices: i * 3 + 2, material: i }] });
    nodes.push({ name: part.name, mesh: i, translation: part.at });
  });
  const bin = new Uint8Array(offset);
  let at = 0;
  for (const c of chunks) {
    bin.set(c, at);
    at += c.length;
  }
  const json = {
    asset: { version: '2.0', generator: 'RacingCoach test car' },
    scene: 0,
    scenes: [{ nodes: [nodes.length] }],
    nodes: [...nodes, { name: 'car', children: nodes.map((_, i) => i) }],
    meshes,
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength: bin.length }],
  };
  return buildGlb(json, bin);
}

// Only when run as a script, never when imported (a test runner's own arguments aren't a file name)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && process.argv[2]) {
  writeFileSync(process.argv[2], testCarGlb());
  console.log(`Wrote ${process.argv[2]}`);
}
