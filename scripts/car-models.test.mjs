// The 3D car models' pure parts (docs/car-models.md): npm run test:car-models
//
// The coordinate convention and its matrices (one normalization places a model the same way in deck.gl and three.js),
// the GLB upload check, the review rules, the exact name lookup, and source guards on the routes and components.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildGlb, checkGlb } from '../src/lib/carModels/glb.ts';
import {
  CANONICAL_TO_THREE,
  basis,
  canonicalBounds,
  deckPoseMatrix,
  dimensions,
  multiply,
  normalizationMatrix,
  toThree,
  transformPoint,
  validAxes,
} from '../src/lib/carModels/matrix.ts';
import {
  checkModelAction,
  editableStatus,
  estimateWheelAnchors,
  modelFileUrl,
  needsAttribution,
  nonCommercial,
  parseCarKeys,
  parseModelSettings,
  parseNormalization,
  parseWheelAnchors,
} from '../src/lib/carModels/modelRules.ts';
import { carPathForName } from '../src/lib/carModels/carPathByName.ts';
import { testCarGlb } from './testCarGlb.mjs';

const close = (a, b, eps = 1e-9) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < eps, `${a} vs ${b}`));

describe('the canonical frame', () => {
  test('glTF +Y up facing +Z becomes +X forward, +Y left, +Z up', () => {
    const b = basis('+y', '+z');
    close(transformPoint(b, [0, 0, 1]), [1, 0, 0]); // forward
    close(transformPoint(b, [0, 1, 0]), [0, 0, 1]); // up
    close(transformPoint(b, [1, 0, 0]), [0, 1, 0]); // glTF's +X is the car's left when it faces +Z
  });

  test('a model facing -Z: its +X is the car’s right', () => {
    const b = basis('+y', '-z');
    close(transformPoint(b, [0, 0, -1]), [1, 0, 0]);
    close(transformPoint(b, [1, 0, 0]), [0, -1, 0]);
  });

  test('every valid basis is a rotation (no mirror): determinant +1', () => {
    for (const up of ['+x', '-x', '+y', '-y', '+z', '-z']) {
      for (const forward of ['+x', '-x', '+y', '-y', '+z', '-z']) {
        if (!validAxes(up, forward)) {
          assert.throws(() => basis(up, forward));
          continue;
        }
        const m = basis(up, forward);
        const det =
          m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);
        assert.ok(Math.abs(det - 1) < 1e-9, `${up} ${forward}`);
      }
    }
  });

  test('normalization centers the plan view, stands the model on the ground, then applies scale, yaw and offset', () => {
    const raw = { min: [-1, 0.2, -2.3], max: [1, 1.6, 2.3] }; // glTF, +Y up, +Z forward, ground 0.2 up
    const n = { up: '+y', forward: '+z', scale: 1, yaw: 0, offset: [0, 0, 0] };
    const b = canonicalBounds(n, raw);
    close(b.min, [-2.3, -1, 0]);
    close(b.max, [2.3, 1, 1.4]);
    const scaled = dimensions(canonicalBounds({ ...n, scale: 0.001 }, { min: [-1000, 0, -2300], max: [1000, 1400, 2300] }));
    close([scaled.length, scaled.width, scaled.height], [4.6, 2, 1.4]);
    const moved = canonicalBounds({ ...n, offset: [0.1, 0, 0.05] }, raw);
    close(moved.min, [-2.2, -1, 0.05]);
    const turned = canonicalBounds({ ...n, yaw: 90 }, raw);
    close(turned.min, [-1, -2.3, 0]);
  });

  test('deck.gl’s pose matrix is its getOrientation convention: pitch nose down, yaw counter-clockwise', () => {
    close(transformPoint(deckPoseMatrix([0, 0, 0], 0, 90), [1, 0, 0]), [0, 1, 0]); // yaw 90: forward is north
    const nose = transformPoint(deckPoseMatrix([0, 0, 0], 10, 0), [1, 0, 0]);
    assert.ok(nose[2] < 0, 'positive pitch puts the nose down, as lapModel3d.ts poses it');
    close(transformPoint(deckPoseMatrix([5, 6, 7], 0, 0), [0, 0, 0]), [5, 6, 7]);
  });

  test('a model placed in Lap Compare: its forward points along the car’s heading', () => {
    const raw = { min: [-1, 0, -2.3], max: [1, 1.4, 2.3] };
    const n = normalizationMatrix({ up: '+y', forward: '+z', scale: 1, yaw: 0, offset: [0, 0, 0] }, raw);
    const m = multiply(deckPoseMatrix([0, 0, 0], 0, 90), n);
    // The model's nose (glTF +Z end, on the ground) ends up north of its tail
    const nose = transformPoint(m, [0, 0, 2.3]);
    const tail = transformPoint(m, [0, 0, -2.3]);
    assert.ok(nose[1] - tail[1] > 4.5 && Math.abs(nose[0] - tail[0]) < 1e-9);
    assert.ok(Math.abs(nose[2]) < 1e-9, 'on the road, not floating or sunk');
  });

  test('three.js is +Y up: the car’s up is three’s +Y, its left three’s -Z', () => {
    close(transformPoint(CANONICAL_TO_THREE, [0, 0, 1]), [0, 1, 0]);
    close(transformPoint(CANONICAL_TO_THREE, [0, 1, 0]), [0, 0, -1]);
    close(toThree([1, 2, 3]), [1, 3, -2]);
  });
});

describe('the GLB upload check', () => {
  const minimal = (extra = {}) =>
    buildGlb({
      asset: { version: '2.0' },
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      accessors: [{ componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 1] }],
      ...extra,
    });

  test('the test car passes, measured through its node transforms', () => {
    const result = checkGlb(testCarGlb());
    assert.ok(result.ok, JSON.stringify(result.problems));
    const { bounds, stats } = result.info;
    close(bounds.min, [-1, 0, -2.3], 1e-6);
    close(bounds.max, [1, 1.395, 2.3], 1e-6);
    assert.equal(stats.triangles, 6 * 12);
    assert.equal(stats.meshes, 6);
    const n = parseNormalization({ up: '+y', forward: '+z', scale: 1, yaw: 0, offset: [0, 0, 0] });
    const d = dimensions(canonicalBounds(n, bounds));
    close([d.length, d.width], [4.6, 2], 1e-6);
  });

  test('not a GLB, a glTF 1 file, a truncated file', () => {
    assert.deepEqual(checkGlb(new TextEncoder().encode('{"asset":{"version":"2.0"}}......')).problems, [{ code: 'notGlb' }]);
    const v1 = buildGlb({ asset: { version: '1.0' } });
    assert.equal(checkGlb(v1).problems[0].code, 'version');
    const cut = testCarGlb().slice(0, 400);
    assert.equal(checkGlb(cut).ok, false);
  });

  test('nothing outside the file: an external buffer or image is refused', () => {
    const external = minimal({ buffers: [{ uri: 'https://example.com/car.bin', byteLength: 10 }] });
    assert.ok(checkGlb(external).problems.some((p) => p.code === 'externalResource'));
    const image = minimal({ images: [{ uri: 'textures/paint.png' }] });
    assert.ok(checkGlb(image).problems.some((p) => p.code === 'externalResource'));
    const ok = minimal({ images: [{ uri: 'data:image/png;base64,iVBORw0KGgo=' }] });
    assert.equal(checkGlb(ok).ok, true);
  });

  test('compression that needs a decoder from a CDN is refused', () => {
    for (const ext of ['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_texture_basisu']) {
      const glb = minimal({ extensionsUsed: [ext], extensionsRequired: [ext] });
      assert.deepEqual(checkGlb(glb).problems, [{ code: 'needsDecoder', detail: ext }]);
    }
    const unknown = minimal({ extensionsRequired: ['EXT_made_up'] });
    assert.equal(checkGlb(unknown).problems[0].code, 'unsupportedExtension');
  });

  test('no geometry, too many triangles, and warnings', () => {
    assert.ok(checkGlb(buildGlb({ asset: { version: '2.0' }, scenes: [{ nodes: [] }] })).problems.some((p) => p.code === 'noGeometry'));
    const huge = minimal({ accessors: [{ componentType: 5126, count: 3 * 2_000_000, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 1] }] });
    assert.equal(checkGlb(huge).problems[0].code, 'tooManyTriangles');
    const animated = minimal({ animations: [{}], skins: [{}] });
    const r = checkGlb(animated);
    assert.ok(r.ok);
    assert.deepEqual(r.info.warnings.map((w) => w.code).sort(), ['animations', 'skins']);
  });
});

describe('the review rules', () => {
  const v = (status, extra = {}) => ({ status, active: false, source: 'sketchfab', license: 'CC-BY-4.0', attribution: 'by someone', ...extra });

  test('uploaded → ready for review → approved or rejected; only approved activates', () => {
    assert.deepEqual(checkModelAction(v('uploaded'), 'submit'), { ok: true, status: 'ready_for_review' });
    assert.deepEqual(checkModelAction(v('ready_for_review'), 'approve'), { ok: true, status: 'approved' });
    assert.deepEqual(checkModelAction(v('ready_for_review'), 'reject'), { ok: true, status: 'rejected' });
    assert.equal(checkModelAction(v('uploaded'), 'approve').ok, false);
    assert.equal(checkModelAction(v('uploaded'), 'activate').code, 'wrongStatus');
    assert.equal(checkModelAction(v('approved'), 'activate').ok, true);
    assert.equal(checkModelAction(v('approved', { active: true }), 'activate').code, 'alreadyActive');
    assert.equal(checkModelAction(v('approved', { active: true }), 'deactivate').ok, true);
  });

  test('activating needs the source and licence, and a CC BY licence the author’s credit', () => {
    assert.equal(checkModelAction(v('approved', { license: '' }), 'activate').code, 'needsProvenance');
    assert.equal(checkModelAction(v('approved', { attribution: ' ' }), 'activate').code, 'needsAttribution');
    assert.equal(checkModelAction(v('approved', { license: 'Bought, standard licence', attribution: '' }), 'activate').ok, true);
    assert.ok(needsAttribution('CC BY-NC-SA 4.0') && needsAttribution('CC-BY-4.0') && !needsAttribution('CC0'));
    assert.ok(nonCommercial('CC-BY-NC-SA-4.0') && !nonCommercial('CC-BY-4.0'));
  });

  test('settings change only while uploaded or rejected', () => {
    assert.ok(editableStatus('uploaded') && editableStatus('rejected'));
    assert.ok(!editableStatus('ready_for_review') && !editableStatus('approved'));
  });

  test('car paths exactly: the Huracán GT3, GT3 EVO and EVO2 are different cars', () => {
    assert.deepEqual(parseCarKeys('LamborghiniEvoGT3, lamborghinievogt3').keys, ['lamborghinievogt3']);
    assert.deepEqual(parseCarKeys('').problems, [{ code: 'carKeys' }]);
    assert.equal(parseCarKeys('not a path!').problems[0].code, 'carKey');
    assert.equal(carPathForName('Lamborghini Huracán GT3 EVO'), 'lamborghinievogt3');
    assert.equal(carPathForName('lamborghini huracan gt3 evo'), 'lamborghinievogt3');
    assert.notEqual(carPathForName('Lamborghini Huracán GT3 EVO2'), 'lamborghinievogt3');
    assert.equal(carPathForName('Lamborghini Huracán GT3 EVO (modified)'), null, 'never a similar name');
    assert.equal(carPathForName('Ferrari 296 GT3'), 'ferrari296gt3');
    assert.equal(carPathForName(''), null);
  });

  test('wheel centers: estimated unverified, and a mirrored or backwards set is refused', () => {
    const anchors = estimateWheelAnchors({ min: [-2.3, -1, 0], max: [2.3, 1, 1.4] }, 2.65);
    assert.ok(Math.abs(anchors.LF.x - anchors.LR.x - 2.65) < 1e-9);
    assert.ok(Object.values(anchors).every((a) => !a.verified));
    assert.deepEqual(parseWheelAnchors(anchors), anchors);
    assert.equal(parseWheelAnchors({ ...anchors, LF: anchors.RF, RF: anchors.LF }), null);
    assert.equal(parseWheelAnchors({ ...anchors, LF: anchors.LR, LR: anchors.LF }), null);
  });

  test('settings are checked whole', () => {
    assert.equal(parseModelSettings({ normalization: { up: '+y', forward: '-y', scale: 1, yaw: 0, offset: [0, 0, 0] } }).ok, false);
    assert.equal(parseModelSettings({ normalization: { up: '+y', forward: '+z', scale: 0, yaw: 0, offset: [0, 0, 0] } }).ok, false);
    assert.equal(parseModelSettings({ defaultView: 'underneath' }).ok, false);
    assert.equal(parseModelSettings({ source: 'x'.repeat(5000) }).ok, false);
    const ok = parseModelSettings({ defaultView: 'top', attribution: '  by me ' });
    assert.deepEqual(ok, { ok: true, settings: { defaultView: 'top', attribution: 'by me' } });
  });

  test('the file’s address carries its hash, so it can be kept for good', () => {
    assert.equal(modelFileUrl(7, 'a'.repeat(64)), `/api/car-models/7/file?v=${'a'.repeat(16)}`);
  });
});

describe('source guards', () => {
  const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

  test('the Admin routes answer 404 to anyone but an Admin', () => {
    for (const p of ['src/app/api/admin/car-models/route.ts', 'src/app/api/admin/car-models/[id]/route.ts']) {
      const src = read(p);
      for (const handler of src.match(/export async function \w+/g)) assert.ok(src.includes('carModelsAdmin()'), `${p} ${handler}`);
    }
    assert.match(read('src/lib/carModels/carModelRoutes.ts'), /!isAdmin\(user\.role\)\) return \{ response: NextResponse\.json\(.*status: 404/);
  });

  test('the file route checks the sign-in, serves only approved active models to non-Admins, and never redirects to storage', () => {
    const src = read('src/app/api/car-models/[id]/file/route.ts');
    assert.match(src, /if \(!user \|\|/);
    assert.match(src, /!file\.servable && !isAdmin\(user\.role\)/);
    assert.doesNotMatch(src, /presign|Location:/);
  });

  test('uploads are read with a size cap, and nothing loads decoders from a CDN', () => {
    assert.match(read('src/app/api/admin/car-models/route.ts'), /readFormDataLimited\(request, GLB_LIMITS\.bytes/);
    for (const p of ['src/components/car3d/threeModels.ts', 'src/lib/carModels/deckModel.ts', 'src/components/car3d/Car3DViewer.tsx']) {
      const src = read(p);
      assert.doesNotMatch(src, /setDecoderPath|DRACOLoader|MeshoptDecoder|https:\/\//, p);
      assert.doesNotMatch(src, /<Environment/, `${p}: drei's Environment presets fetch HDRs from a CDN`);
    }
  });

  test('the viewers are loaded in the browser only', () => {
    assert.match(read('src/components/car3d/Car3DViewerLazy.tsx'), /ssr: false/);
    assert.match(read('src/components/DrivingLineMap.tsx'), /ssr: false/);
  });
});
