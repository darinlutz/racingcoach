// The engineering car drawings kept in the repository: npm run test:car-views (docs/car-views.md)
//
// Every set in data/car-drawings/ (the Lovable project darinlutz/racingcoach-car-drawings) imports as a valid draft:
// each SVG passes the sanitizer with its body and wheels as layers, and each view's anchors, converted from the
// drawings' millimetres, keep this site's orientation rules (so a mirrored view would fail here), stand the wheels on
// the ground a tire radius up, and stay unverified.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { checkViewAnchors, verifiedShare } from '../src/lib/carViews/anchors.ts';
import { validateDraft } from '../src/lib/carViews/assetRules.ts';
import { BUNDLED_DRAWINGS, bundledDraftInput, listBundledDrawings, nameKey } from '../src/lib/carViews/bundledDrawings.ts';
import { lovableViewAnchors, withLovableLayers } from '../src/lib/carViews/lovableImport.ts';
import { CAR_VIEWS, visibleCorners } from '../src/lib/carViews/views.ts';

describe('the repository’s car drawings', () => {
  test('both cars have all five views', async () => {
    const sets = await listBundledDrawings();
    assert.deepEqual(
      sets.map((s) => [s.id, s.views]),
      [
        ['huracan-gt3-evo', [...CAR_VIEWS]],
        ['ferrari-296-gt3', [...CAR_VIEWS]],
      ]
    );
    for (const s of sets) assert.match(s.license, /CC-BY-4\.0/);
  });

  for (const set of BUNDLED_DRAWINGS) {
    test(`${set.id} imports as a valid draft, its anchors in this site’s conventions`, async () => {
      const input = await bundledDraftInput(set.id, 1);
      const result = validateDraft(input);
      assert.ok(result.ok, JSON.stringify(result.ok ? null : result.problems.slice(0, 5)));
      const { draft } = result;
      assert.deepEqual(draft.carKeys, set.carKeys);
      assert.match(draft.sources, /sketchfab\.com/);
      assert.match(draft.license, /CC-BY-4\.0: credit/);
      for (const view of CAR_VIEWS) {
        const art = draft.views[view];
        assert.ok(art, view);
        assert.deepEqual(checkViewAnchors(view, art.anchors), [], `${set.id} ${view}`);
        assert.equal(verifiedShare(art.anchors).verified, 0, `${set.id} ${view}: drafts are unverified`);
        assert.match(art.inner, /<g id="body" data-layer="body"/, `${set.id} ${view}`);
        assert.match(art.inner, /<g id="wheels" data-layer="wheels"/, `${set.id} ${view}`);
        assert.equal(Object.keys(art.anchors.wheelCenters).sort().join(), [...visibleCorners(view)].sort().join(), `${set.id} ${view}`);
        if (view === 'top') continue;
        // 1 unit = 1 mm: each wheel center is a tire radius (330-360 mm) above the ground
        for (const corner of visibleCorners(view)) {
          const radius = (art.anchors.groundY - art.anchors.wheelCenters[corner].y) * art.viewBox.height;
          assert.ok(radius > 330 && radius < 380, `${set.id} ${view} ${corner}: ${radius.toFixed(1)} mm`);
          assert.ok(Math.abs(art.anchors.contactPatches[corner].y - art.anchors.groundY) < 1e-9);
        }
      }
      // Front and rear: the car's left on the screen's right from the front, on the left from behind
      assert.ok(draft.views.front.anchors.wheelCenters.LF.x > draft.views.front.anchors.wheelCenters.RF.x);
      assert.ok(draft.views.rear.anchors.wheelCenters.LR.x < draft.views.rear.anchors.wheelCenters.RR.x);
      // A centerline ride height reference isn't a corner's, so it isn't given to one
      assert.deepEqual(draft.views.front.anchors.rideHeightPoints, {});
      assert.ok(draft.views['left-side'].anchors.rideHeightPoints.LF);
      assert.ok(draft.views['left-side'].anchors.wing && draft.views.front.anchors.splitter);
    });
  }

  test('the converter: millimetres to fractions, boxes to their centers', () => {
    const anchors = lovableViewAnchors('left-side', {
      viewBox: [0, 0, 1000, 500],
      groundY: 450,
      anchors: { front_wheel_center: [200, 100], rear_wheel_center: [800, 100], front_contact_patch: [200, 450], rear_wing: { x1: 900, y1: 0, x2: 1000, y2: 100 } },
    });
    assert.deepEqual(anchors.wheelCenters.LF, { x: 0.2, y: 0.2, verified: false });
    assert.deepEqual(anchors.contactPatches.LF, { x: 0.2, y: 0.9, verified: false });
    assert.equal(anchors.groundY, 0.9);
    assert.deepEqual(anchors.wing, { x: 0.95, y: 0.1, verified: false });
    assert.equal(withLovableLayers('<g id="wheels" fill="none">'), '<g id="wheels" data-layer="wheels" fill="none">');
  });

  test('a set is suggested for Car Data’s car by its name, accents and case aside', () => {
    assert.equal(nameKey('Lamborghini Huracán GT3 EVO'), nameKey('Lamborghini Huracan GT3 EVO'));
  });
});
