// The engineering car drawings' pure modules: npm run test:car-views (docs/car-views.md)
//
// The five views' orientation, the anchor contract and placement, the SVG sanitizer (what it keeps, what it refuses),
// the generic car's drawing of each view (its tires drawn the way each view sees them, each wheel once), and the
// asset rules (the review workflow, exact car paths, the generic fallback).

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { CAR_VIEWS, SCREEN_ORDER, TIRE_PROFILE, visibleCorners } from '../src/lib/carViews/views.ts';
import { checkViewAnchors, hostX, hostY, parseViewAnchors, placeView, toHost, verifiedShare } from '../src/lib/carViews/anchors.ts';
import { sanitizeSvg, scopeIds, SVG_LIMITS } from '../src/lib/carViews/svgSanitize.ts';
import { GENERIC_DIMENSIONS, genericArt, genericSources } from '../src/lib/carViews/genericVehicle.ts';
import { checkAction, resolveView, validateDraft, viewCoverage } from '../src/lib/carViews/assetRules.ts';

const wrap = (inner, viewBox = '0 0 100 50') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${inner}</svg>`;
const codes = (result) => (result.ok ? [] : result.problems.map((p) => p.code));

// A valid front view's anchors: RF on the screen's left, LF on its right
const frontAnchors = () => ({
  wheelCenters: { RF: { x: 0.2, y: 0.7, verified: true }, LF: { x: 0.8, y: 0.7, verified: true } },
  contactPatches: { RF: { x: 0.2, y: 0.93 }, LF: { x: 0.8, y: 0.93 } },
  rideHeightPoints: { RF: { x: 0.3, y: 0.87 }, LF: { x: 0.7, y: 0.87 } },
  groundY: 0.93,
  centerlineX: 0.5,
});

describe('views', () => {
  test('five views, each with the corners it shows in screen order', () => {
    assert.deepEqual([...CAR_VIEWS], ['left-side', 'right-side', 'top', 'front', 'rear']);
    assert.deepEqual([...SCREEN_ORDER.front], ['RF', 'LF'], 'from the front the car’s left is on the screen’s right');
    assert.deepEqual([...SCREEN_ORDER.rear], ['LR', 'RR'], 'from behind the car’s left is on the screen’s left');
    assert.deepEqual([...SCREEN_ORDER['left-side']], ['LF', 'LR'], 'left side: nose left');
    assert.deepEqual([...SCREEN_ORDER['right-side']], ['RR', 'RF'], 'right side: nose right');
    assert.deepEqual([...visibleCorners('top')], ['LF', 'RF', 'LR', 'RR']);
  });
  test('each view has its own tire profile, never circles end on', () => {
    assert.equal(TIRE_PROFILE['left-side'], 'sidewall');
    assert.equal(TIRE_PROFILE['right-side'], 'sidewall');
    assert.equal(TIRE_PROFILE.top, 'footprint');
    assert.equal(TIRE_PROFILE.front, 'width');
    assert.equal(TIRE_PROFILE.rear, 'width');
  });
});

describe('anchors', () => {
  test('valid anchors parse, unverified unless said', () => {
    const { anchors, problems } = parseViewAnchors('front', frontAnchors());
    assert.deepEqual(problems, []);
    assert.equal(anchors.wheelCenters.LF.verified, true);
    assert.equal(anchors.contactPatches.LF.verified, false);
    assert.deepEqual(verifiedShare(anchors), { verified: 2, total: 6 });
  });
  test('a drawing mirrored by mistake is refused, not relabelled', () => {
    const raw = frontAnchors();
    raw.wheelCenters = { RF: raw.wheelCenters.LF, LF: raw.wheelCenters.RF };
    const { problems } = parseViewAnchors('front', raw);
    assert.deepEqual(problems, [{ code: 'orientation', first: 'RF', second: 'LF' }]);
    const rear = parseViewAnchors('rear', { wheelCenters: { LR: { x: 0.8, y: 0.7 }, RR: { x: 0.2, y: 0.7 } }, groundY: 0.93 });
    assert.ok(rear.problems.some((p) => p.code === 'orientation'));
    const top = parseViewAnchors('top', {
      wheelCenters: { LF: { x: 0.2, y: 0.8 }, RF: { x: 0.8, y: 0.8 }, LR: { x: 0.2, y: 0.2 }, RR: { x: 0.8, y: 0.2 } },
    });
    assert.ok(top.problems.some((p) => p.code === 'orientation' && p.first === 'LF' && p.second === 'LR'), 'top view: the nose up');
  });
  test('corners the view can’t show, ranges, ground and contact patches', () => {
    const raw = frontAnchors();
    raw.wheelCenters.LR = { x: 0.5, y: 0.5 };
    raw.contactPatches.LF = { x: 0.8, y: 0.5 };
    raw.groundY = 1.4;
    const { problems } = parseViewAnchors('front', raw);
    assert.ok(problems.some((p) => p.code === 'hiddenCorner' && p.corner === 'LR'));
    assert.ok(problems.some((p) => p.code === 'outOfRange' && p.anchor === 'groundY'));
    assert.ok(problems.some((p) => p.code === 'missingGround'));
    const off = parseViewAnchors('front', { ...frontAnchors(), contactPatches: { LF: { x: 0.8, y: 0.5 } } });
    assert.ok(off.problems.some((p) => p.code === 'contactOffGround' && p.corner === 'LF'));
    const below = parseViewAnchors('front', { ...frontAnchors(), groundY: 0.6 });
    assert.ok(below.problems.some((p) => p.code === 'wheelBelowGround'));
    assert.ok(parseViewAnchors('top', { ...frontAnchors(), groundY: 0.5 }).problems.some((p) => p.code === 'groundInTopView'));
    assert.deepEqual(parseViewAnchors('top', 'nope').problems, [{ code: 'notObject' }]);
    assert.ok(parseViewAnchors('left-side', { groundY: 0.9 }).problems.some((p) => p.code === 'missingWheel' && p.corner === 'LF'));
  });
  test('placement: a box, standing on the ground, and axles at two heights', () => {
    const art = { viewBox: { x: 0, y: 0, width: 200, height: 100 }, anchors: { ...parseViewAnchors('front', frontAnchors()).anchors } };
    const box = placeView(art, { kind: 'box', x: 10, y: 10, width: 100, height: 100 });
    assert.equal(box.scale, 0.5);
    assert.deepEqual(toHost(box, { x: 0, y: 0 }), [10, 35], 'centered in the box');
    const ground = placeView(art, { kind: 'ground', x: 0, width: 400, groundY: 300, maxHeight: 93 });
    assert.equal(ground.scale, 1);
    assert.equal(hostY(ground, 0.93), 300, 'the ground anchor lands on the host’s ground line');
    assert.equal(hostX(ground, 0.5), 200);
    const top = genericArt('top');
    const axles = placeView(top, { kind: 'axles', centerX: 200, frontY: 150, rearY: 400 });
    assert.ok(Math.abs(toHost(axles, top.anchors.wheelCenters.LF)[1] - 150) < 1e-9);
    assert.ok(Math.abs(toHost(axles, top.anchors.wheelCenters.RR)[1] - 400) < 1e-9);
    assert.ok(Math.abs((toHost(axles, top.anchors.wheelCenters.LF)[0] + toHost(axles, top.anchors.wheelCenters.RF)[0]) / 2 - 200) < 1e-9);
  });
});

describe('SVG sanitizer', () => {
  test('keeps shapes, layers, gradients and local references, and writes them again', () => {
    const result = sanitizeSvg(
      `<?xml version="1.0"?><!-- drawn by hand --><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="400" viewBox="0 0 100 50">` +
        `<defs><linearGradient id="g1"><stop offset="0" stop-color="#fff"/></linearGradient></defs>` +
        `<g data-layer="body" class="ecv-body"><path d="M0 0 L10 10 Z" fill="url(#g1)" style="stroke:#333;stroke-width:2"/></g>` +
        `<use xlink:href="#g1"/><title>A &amp; B</title></svg>`
    );
    assert.ok(result.ok, JSON.stringify(result.problems));
    assert.deepEqual(result.svg.viewBox, { x: 0, y: 0, width: 100, height: 50 });
    assert.match(result.svg.inner, /<path d="M0 0 L10 10 Z" fill="url\(#g1\)" stroke="#333" stroke-width="2"\/>/);
    assert.match(result.svg.inner, /<use href="#g1"\/>/);
    assert.match(result.svg.inner, /<title>A &amp; B<\/title>/);
    assert.doesNotMatch(result.svg.inner, /xmlns|width="400"|<!--/);
  });
  test('editor metadata is dropped quietly', () => {
    const result = sanitizeSvg(wrap('<metadata><rdf:RDF><cc:Work/></rdf:RDF></metadata><sodipodi:namedview inkscape:zoom="1"/><rect x="1" y="1" width="2" height="2" inkscape:label="r"/>'));
    assert.ok(result.ok, JSON.stringify(result.problems));
    assert.equal(result.svg.inner, '<rect x="1" y="1" width="2" height="2"/>');
  });
  const refused = [
    ['a script', '<script>alert(1)</script>', 'element'],
    ['an event handler', '<rect onload="alert(1)" width="1" height="1"/>', 'eventHandler'],
    ['an event handler in capitals', '<rect ONCLICK="x()" width="1" height="1"/>', 'eventHandler'],
    ['foreignObject', '<foreignObject><div/></foreignObject>', 'element'],
    ['an image', '<image href="https://example.com/a.png"/>', 'element'],
    ['a style sheet', '<style>rect{fill:red}</style>', 'element'],
    ['an external use', '<use href="https://example.com/a.svg#x"/>', 'externalReference'],
    ['a javascript link', '<use href="javascript:alert(1)"/>', 'externalReference'],
    ['an external url() paint', '<rect fill="url(https://example.com/x)" width="1" height="1"/>', 'externalReference'],
    ['a url() in a style', '<rect style="fill:url(http://x/y)" width="1" height="1"/>', 'externalReference'],
    ['an unknown style property', '<rect style="behavior:url(#x)" width="1" height="1"/>', 'attribute'],
    ['an entity in a value', '<rect fill="&#106;avascript" width="1" height="1"/>', 'value'],
    ['a bad path', '<path d="M0 0 expression(alert(1))"/>', 'value'],
    ['a filter', '<filter id="f"><feImage href="https://x"/></filter>', 'element'],
    ['an animation', '<animate attributeName="href" to="javascript:alert(1)"/>', 'element'],
    ['text in the drawing', '<g>Hello</g>', 'text'],
    ['a text element', '<text>LF 3.1 mm</text>', 'element'],
    ['a nested svg', '<svg viewBox="0 0 1 1"/>', 'element'],
    ['a link', '<a href="https://example.com"><rect width="1" height="1"/></a>', 'element'],
  ];
  for (const [name, inner, code] of refused) {
    test(`refuses ${name}`, () => {
      assert.ok(codes(sanitizeSvg(wrap(inner))).includes(code), JSON.stringify(sanitizeSvg(wrap(inner))));
    });
  }
  test('refuses DOCTYPEs, entities, CDATA, other documents, missing viewBoxes and broken markup', () => {
    assert.ok(codes(sanitizeSvg(`<!DOCTYPE svg [<!ENTITY x "y">]>${wrap('<rect/>')}`)).includes('forbiddenMarkup'));
    assert.ok(codes(sanitizeSvg(wrap('<![CDATA[<script>x</script>]]>'))).includes('forbiddenMarkup'));
    assert.deepEqual(codes(sanitizeSvg('<html><body/></html>')), ['notSvg']);
    assert.ok(codes(sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>')).includes('viewBox'));
    assert.ok(codes(sanitizeSvg(wrap('<g><rect></g>'))).includes('malformed'));
    assert.ok(codes(sanitizeSvg(`${wrap('<rect/>')}<script>x</script>`)).includes('malformed'), 'nothing after the drawing');
    assert.ok(codes(sanitizeSvg(wrap('<rect/>') + '<rect/>')).includes('malformed'));
  });
  test('size, element and depth limits', () => {
    assert.deepEqual(codes(sanitizeSvg(wrap(' '.repeat(SVG_LIMITS.bytes)))), ['tooLarge']);
    assert.ok(codes(sanitizeSvg(wrap('<rect/>'.repeat(SVG_LIMITS.elements + 1)))).includes('tooManyElements'));
    assert.ok(codes(sanitizeSvg(wrap('<g>'.repeat(SVG_LIMITS.depth + 1) + '</g>'.repeat(SVG_LIMITS.depth + 1)))).includes('tooDeep'));
  });
  test('ids are scoped to each copy of a drawing', () => {
    const { svg } = sanitizeSvg(wrap('<defs><clipPath id="c"><rect width="1" height="1"/></clipPath></defs><g clip-path="url(#c)"><use href="#c"/></g>'));
    const scoped = scopeIds(svg.inner, 'ecv12');
    assert.match(scoped, /id="ecv12-c"/);
    assert.match(scoped, /clip-path="url\(#ecv12-c\)"/);
    assert.match(scoped, /href="#ecv12-c"/);
  });
  test('its own output passes it again unchanged', () => {
    for (const view of CAR_VIEWS) {
      const art = genericArt(view);
      const again = sanitizeSvg(wrap(art.inner, `${art.viewBox.x} ${art.viewBox.y} ${art.viewBox.width} ${art.viewBox.height}`));
      assert.ok(again.ok, view);
      assert.equal(again.svg.inner, art.inner, view);
    }
  });
});

const tiresOf = (inner) => {
  const wheels = inner.match(/<g data-layer="wheels">([\s\S]*)<\/g>$/)?.[1] ?? '';
  return [...wheels.matchAll(/<(\w+) class="ecv-tire" data-part="tire"([^>]*)\/>/g)].map(([, tag, attrs]) => ({ tag, attrs }));
};

describe('the generic car', () => {
  test('every view passes the sanitizer and keeps its own anchor rules', () => {
    for (const view of CAR_VIEWS) {
      const { source, anchors } = genericSources()[view];
      assert.ok(sanitizeSvg(source).ok, view);
      assert.deepEqual(checkViewAnchors(view, anchors), [], view);
      assert.equal(verifiedShare(anchors).verified, 0, `${view}: nothing about the generic car is verified`);
    }
  });
  test('tires: circles from the side, footprints from above, tire widths end on', () => {
    for (const view of ['left-side', 'right-side']) {
      const tires = tiresOf(genericArt(view).inner);
      assert.deepEqual(tires.map((t) => t.tag), ['circle', 'circle'], view);
      assert.match(tires[0].attrs, new RegExp(`r="${GENERIC_DIMENSIONS.tireRadius}"`));
    }
    const top = tiresOf(genericArt('top').inner);
    assert.deepEqual(top.map((t) => t.tag), ['rect', 'rect', 'rect', 'rect']);
    assert.match(top[0].attrs, new RegExp(`width="${GENERIC_DIMENSIONS.frontTireWidth}" height="${GENERIC_DIMENSIONS.tireRadius * 2}"`));
    assert.match(top[2].attrs, new RegExp(`width="${GENERIC_DIMENSIONS.rearTireWidth}"`), 'the rear tires are wider');
    for (const view of ['front', 'rear']) {
      const art = genericArt(view);
      const tires = tiresOf(art.inner);
      assert.deepEqual(tires.map((t) => t.tag), ['rect', 'rect'], `${view}: tire widths, not circles`);
      const wheels = art.inner.slice(art.inner.indexOf('data-layer="wheels"'));
      assert.doesNotMatch(wheels, /<circle/, `${view}: no circle anywhere in the wheels`);
      const width = Number(tires[0].attrs.match(/width="([\d.]+)"/)[1]);
      const height = Number(tires[0].attrs.match(/height="([\d.]+)"/)[1]);
      assert.ok(width < height / 2, `${view}: a tire end on is much narrower than it is tall`);
      assert.equal(width, view === 'front' ? GENERIC_DIMENSIONS.frontTireWidth : GENERIC_DIMENSIONS.rearTireWidth);
    }
  });
  test('each wheel is drawn once, at its anchor, standing on the ground', () => {
    for (const view of CAR_VIEWS) {
      const art = genericArt(view);
      const corners = [...art.inner.matchAll(/data-part="wheel" data-corner="(\w+)"/g)].map((m) => m[1]);
      assert.deepEqual(corners.sort(), [...visibleCorners(view)].sort(), view);
      assert.equal(tiresOf(art.inner).length, visibleCorners(view).length, `${view}: one tire per corner`);
      if (view === 'top') continue;
      for (const corner of visibleCorners(view)) {
        const c = art.anchors.contactPatches[corner];
        assert.ok(Math.abs(c.y - art.anchors.groundY) < 1e-9, `${view} ${corner} contact on the ground`);
        const w = art.anchors.wheelCenters[corner];
        const radius = (art.anchors.groundY - w.y) * art.viewBox.height;
        assert.ok(Math.abs(radius - GENERIC_DIMENSIONS.tireRadius) < 0.5, `${view} ${corner} wheel center a tire radius up`);
      }
    }
  });
  test('the generic right side is labelled RF and RR, nose right', () => {
    const art = genericArt('right-side');
    assert.match(art.inner, /data-corner="RF"/);
    assert.doesNotMatch(art.inner, /data-corner="L[FR]"/);
    assert.ok(art.anchors.wheelCenters.RF.x > art.anchors.wheelCenters.RR.x);
  });
});

describe('asset rules', () => {
  const svg = genericSources().front.source;
  const good = { carId: 7, carKeys: ['LamborghiniEVOGT3', 'lamborghinievogt3'], views: { front: { svg, anchors: frontAnchors() } }, sources: 'Owner photos', license: 'Own work', notes: '' };
  test('a valid draft: car paths exact and lowercased once, views sanitized', () => {
    const result = validateDraft(good);
    assert.ok(result.ok, JSON.stringify(result.problems));
    assert.deepEqual(result.draft.carKeys, ['lamborghinievogt3']);
    assert.deepEqual(viewCoverage(result.draft.views), ['front']);
    assert.equal(result.draft.views.front.hasWheels, true);
  });
  test('nothing is saved while anything is wrong', () => {
    const result = validateDraft({ ...good, carId: 0, carKeys: ['Lamborghini Huracán GT3 EVO'], views: { side: { svg }, front: { svg: wrap('<script/>'), anchors: {} } } });
    assert.equal(result.ok, false);
    const got = result.problems.map((p) => p.code);
    for (const code of ['car', 'carKey', 'unknownView', 'svg']) assert.ok(got.includes(code), code);
    assert.ok(!validateDraft({ ...good, views: {} }).ok);
    assert.ok(validateDraft({ ...good, views: { front: { svg, anchors: { ...frontAnchors(), groundY: null } } } }).problems.some((p) => p.code === 'anchors'));
  });
  test('the review workflow, and activation needs sources and a licence', () => {
    const v = (status, extra = {}) => ({ status, active: false, sources: 's', license: 'l', ...extra });
    assert.deepEqual(checkAction(v('draft'), 'submit'), { ok: true, status: 'under_review' });
    assert.deepEqual(checkAction(v('under_review'), 'approve'), { ok: true, status: 'approved' });
    assert.deepEqual(checkAction(v('under_review'), 'reject'), { ok: true, status: 'rejected' });
    assert.deepEqual(checkAction(v('draft'), 'approve'), { ok: false, code: 'wrongStatus' });
    assert.deepEqual(checkAction(v('under_review'), 'activate'), { ok: false, code: 'wrongStatus' });
    assert.deepEqual(checkAction(v('approved', { license: ' ' }), 'activate'), { ok: false, code: 'needsProvenance' });
    assert.deepEqual(checkAction(v('approved'), 'activate'), { ok: true, status: 'approved' });
    assert.deepEqual(checkAction(v('approved', { active: true }), 'activate'), { ok: false, code: 'alreadyActive' });
    assert.deepEqual(checkAction(v('approved'), 'deactivate'), { ok: false, code: 'notActive' });
  });
  test('a view the car hasn’t got, or a car without drawings, shows the generic car with the reason', () => {
    const draft = validateDraft(good).draft;
    const asset = { id: 1, version: 1, carId: 7, carName: 'Lamborghini', status: 'approved', active: true, views: draft.views, notes: '' };
    assert.deepEqual({ ...resolveView(asset, 'front'), art: undefined }, { art: undefined, source: 'approved', reason: null });
    assert.equal(resolveView({ ...asset, active: false }, 'front').source, 'preview');
    const missing = resolveView(asset, 'top');
    assert.equal(missing.source, 'generic');
    assert.equal(missing.reason, 'missingView');
    assert.equal(missing.art, genericArt('top'));
    assert.equal(resolveView(null, 'rear').reason, 'noAsset');
  });
});
