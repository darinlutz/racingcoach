// Converts the traced car drawings from the Lovable project darinlutz/five-more-fast-cars (its car-svgs folder) into
// data/car-drawings/'s format (docs/car-views.md), so the Admin page's Drawings in the repository panel imports them
// like the others: node scripts/importTracedCarDrawings.mjs <path to car-svgs>
//
// Those drawings are potrace tracings of 2400x1400 renders: filled outlines in one group, no wheels layer, and anchors
// files giving only each view's bounding box and ground line. So this script
//  - measures each side view's two wheels: the circle (centre on a vertical line, touching the ground line) that the
//    most drawn pixels lie on, searched over the front and rear halves of the car;
//  - moves every traced shape that lies inside a measured wheel into <g id="wheels">, the rest into <g id="body">;
//  - estimates the top, front and rear views' wheel centres from the side view's, through each view's scale (the
//    length in the top view, the width across the top, front and rear views) and a half track that's a share of the
//    car's width (HALF_TRACK, from the reference Ferrari's measured drawings), as their tires are hidden or cropped;
//  - writes <prefix>-<view>.svg, <prefix>-anchors.json in the existing anchors format, and VALIDATION-NOTES.md
//    saying which anchors were measured and which estimated, and the model and licence notes from the source.
// Every anchor is unverified, as for every draft: the Admin page's SVG debug mode shows them for checking.

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const SOURCE = process.argv[2];
if (!SOURCE) {
  console.error('Usage: node scripts/importTracedCarDrawings.mjs <car-svgs folder>');
  process.exit(1);
}
const OUT = path.join(process.cwd(), 'data', 'car-drawings');
const W = 2400;
const H = 1400;

// Each car: its source prefix, the folder and prefix here, and the half track as a share of its width in the top view
// (with its mirrors; the Ferrari's earlier measured drawings give 0.358). Each model's licence is recorded as it is,
// NonCommercial ones included (the Ferrari, Toyota and Mazda; the owner is getting their authors' permission after
// importing them). The Ferrari replaces the earlier Ferrari 296 GT3 set (in git history); the Mazda is for the Global
// Mazda MX-5 Cup's car path (mx5 mx52016), the setups folder the owner has
const CARS = [
  { source: 'ferrari-296-gt3', folder: 'ferrari-296-gt3', prefix: 'ferrari-296-gt3', halfTrack: 0.358 },
  { source: 'mazda-mx5-cup', folder: 'mazda-mx5-cup-2010', prefix: 'mazda-mx5-cup-2010', halfTrack: 0.385 },
  { source: 'mercedes-amg-f1', folder: 'mercedes-amg-f1', prefix: 'mercedes-amg-f1', halfTrack: 0.4 },
  { source: 'nascar-camaro-zl1', folder: 'nascar-camaro-zl1-next-gen', prefix: 'nascar-camaro-zl1-next-gen', halfTrack: 0.4 },
  { source: 'toyota-gr86', folder: 'toyota-gr86', prefix: 'toyota-gr86', halfTrack: 0.37 },
];

// ---- Reading the traced paths ----

// potrace's path data: an absolute M, then relative c, l and m, z closing each outline
function subpaths(d) {
  const tokens = d.match(/[MmCcLlZz]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) ?? [];
  const out = [];
  let i = 0;
  let cmd = '';
  let cx = 0;
  let cy = 0;
  let start = [0, 0];
  let current = null;
  const num = () => Number(tokens[i++]);
  // The outline's signed area (shoelace over its points), whose sign tells an outline from a hole in it
  const step = (x, y) => {
    current.area += current.lastX * y - x * current.lastY;
    current.lastX = x;
    current.lastY = y;
    current.points.push(x, y);
  };
  const touch = (x, y) => {
    current.minX = Math.min(current.minX, x);
    current.maxX = Math.max(current.maxX, x);
    current.minY = Math.min(current.minY, y);
    current.maxY = Math.max(current.maxY, y);
  };
  while (i < tokens.length) {
    if (/[A-Za-z]/.test(tokens[i])) cmd = tokens[i++];
    if (cmd === 'M' || cmd === 'm') {
      const x = num();
      const y = num();
      if (cmd === 'm' && out.length) {
        cx += x;
        cy += y;
      } else {
        cx = x;
        cy = y;
      }
      start = [cx, cy];
      current = { startX: cx, startY: cy, body: '', minX: cx, maxX: cx, minY: cy, maxY: cy, area: 0, lastX: cx, lastY: cy, points: [cx, cy] };
      out.push(current);
      // Further pairs after a moveto are linetos
      cmd = cmd === 'm' ? 'l' : 'L';
      continue;
    }
    if (cmd === 'z' || cmd === 'Z') {
      current.body += 'z';
      [cx, cy] = start;
      step(cx, cy);
      continue;
    }
    if (cmd === 'c') {
      const v = [num(), num(), num(), num(), num(), num()];
      touch(cx + v[0], cy + v[1]);
      touch(cx + v[2], cy + v[3]);
      // Points along the curve, so the area is the curve's and not its chord's (a ring's hole is only a little smaller
      // than the ring)
      for (const t of [0.25, 0.5, 0.75]) {
        const u = 1 - t;
        const bx = 3 * u * u * t * v[0] + 3 * u * t * t * v[2] + t * t * t * v[4];
        const by = 3 * u * u * t * v[1] + 3 * u * t * t * v[3] + t * t * t * v[5];
        step(cx + bx, cy + by);
      }
      cx += v[4];
      cy += v[5];
      touch(cx, cy);
      step(cx, cy);
      current.body += `c${v.join(' ')}`;
      continue;
    }
    if (cmd === 'l') {
      const v = [num(), num()];
      cx += v[0];
      cy += v[1];
      touch(cx, cy);
      step(cx, cy);
      current.body += `l${v.join(' ')}`;
      continue;
    }
    throw new Error(`Unexpected path command ${cmd}`);
  }
  return out;
}

function readTraced(file) {
  const text = fs.readFileSync(file, 'utf8');
  const group = /<g transform="translate\(([-\d.]+),([-\d.]+)\) scale\(([-\d.]+),([-\d.]+)\)"\s*fill="([^"]+)"/.exec(text);
  if (!group) throw new Error(`${file}: no potrace group`);
  const [tx, ty, sx, sy] = group.slice(1, 5).map(Number);
  const fill = group[5];
  const paths = [...text.matchAll(/<path d="([^"]+)"/g)].map((m) => subpaths(m[1].replace(/\s+/g, ' ')));
  // A subpath's box in the drawing's coordinates
  const box = (p) => {
    const xs = [tx + p.minX * sx, tx + p.maxX * sx];
    const ys = [ty + p.minY * sy, ty + p.maxY * sy];
    return { x1: Math.min(...xs), x2: Math.max(...xs), y1: Math.min(...ys), y2: Math.max(...ys) };
  };
  return { text, transform: `translate(${tx},${ty}) scale(${sx},${sy})`, fill, paths, box };
}

// ---- Measuring a side view's wheels ----

async function inkOf(file) {
  const { data, info } = await sharp(file, { density: 72 }).resize(W, H, { fit: 'fill' }).greyscale().raw().toBuffer({ resolveWithObject: true });
  // The drawn lines, thickened a pixel so a circle's points find them
  const ink = new Uint8Array(W * H);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      let on = 0;
      for (let dy = -1; dy <= 1 && !on; dy++) for (let dx = -1; dx <= 1 && !on; dx++) if (data[(y + dy) * info.width + x + dx] > 60) on = 1;
      ink[y * W + x] = on;
    }
  }
  return ink;
}

// The tire: the circle near the ground line with drawn lines all the way round it, its centre between x0 and x1. A
// fender arch has lines over its top only, and a rim is smaller, so the score is the worst of the circle's four
// quarters (a full circle scores on all of them), with larger circles favoured a little
const N = 96;
const COS = Array.from({ length: N }, (_, i) => Math.cos((i / N) * Math.PI * 2));
const SIN = Array.from({ length: N }, (_, i) => Math.sin((i / N) * Math.PI * 2));
function circleScore(ink, cx, cy, r) {
  const quarter = [0, 0, 0, 0];
  for (let i = 0; i < N; i++) {
    const x = Math.round(cx + COS[i] * r);
    const y = Math.round(cy + SIN[i] * r);
    if (x >= 0 && x < W && y >= 0 && y < H && ink[y * W + x]) quarter[Math.floor((i * 4) / N)]++;
  }
  const fractions = quarter.map((q) => q / (N / 4));
  const worst = Math.min(...fractions);
  const mean = fractions.reduce((a, b) => a + b, 0) / 4;
  return { score: worst * 0.7 + mean * 0.3 + r * 0.00005, hits: mean, worst };
}
// The rim: the circle with drawn lines all the way round it, in the lower part of the car, its centre between x0 and
// x1. The renders draw a wheel's rim and hub but not the tire's outside (black on black), so the wheel is found by its
// rim, and the tire's radius is from the rim's centre down to the ground line
function bestRim(ink, ground, x0, x1, rMin, rMax) {
  let best = { score: -1 };
  for (let r = rMin; r <= rMax; r += 2) {
    for (let cy = Math.round(ground - rMax * 2.6); cy <= ground - r; cy += 3) {
      for (let cx = Math.max(x0, r); cx <= Math.min(x1, W - r); cx += 3) {
        const s = circleScore(ink, cx, cy, r);
        if (s.score > best.score) best = { ...s, cx, cy, r };
      }
    }
  }
  const coarse = best;
  for (let r = coarse.r - 2; r <= coarse.r + 2; r++) {
    for (let cy = coarse.cy - 3; cy <= coarse.cy + 3; cy++) {
      for (let cx = coarse.cx - 3; cx <= coarse.cx + 3; cx++) {
        const s = circleScore(ink, cx, cy, r);
        if (s.score > best.score) best = { ...s, cx, cy, r };
      }
    }
  }
  return best;
}

async function measureSide(file, bbox, ground) {
  const ink = await inkOf(file);
  const rMin = Math.round(bbox.width * 0.035);
  const rMax = Math.round(bbox.width * 0.085);
  const mid = bbox.x + bbox.width / 2;
  return [bestRim(ink, ground, bbox.x, mid, rMin, rMax), bestRim(ink, ground, mid, bbox.x + bbox.width, rMin, rMax)].map((rim) => ({
    cx: rim.cx,
    cy: rim.cy,
    // The tire: from the rim's centre to the ground
    r: ground - rim.cy,
    rim: rim.r,
    hits: rim.hits,
    worst: rim.worst,
  }));
}

// ---- Writing ----

const r1 = (n) => Math.round(n * 10) / 10;

function writeSvg(car, view, traced, wheels, title, desc) {
  // Within the wheel: its box inside the square round the tire (a round rim's box corners lie outside the circle), and
  // its centre inside the circle
  const inWheel = (b) =>
    wheels.some(
      (w) =>
        Math.max(w.cx - b.x1, b.x2 - w.cx, w.cy - b.y1, b.y2 - w.cy) <= w.r * 1.04 &&
        Math.hypot((b.x1 + b.x2) / 2 - w.cx, (b.y1 + b.y2) / 2 - w.cy) <= w.r
    );
  // Each traced path keeps its outlines together, as a hole only cuts its outline out within the same path: an
  // outline inside a wheel goes to the wheels layer, and each hole (an outline turning the other way) goes with the
  // smallest outline round it
  const body = [];
  const wheel = [];
  for (const outlines of traced.paths) {
    if (!outlines.length) continue;
    const sign = Math.sign(outlines.reduce((a, b) => (Math.abs(b.area) > Math.abs(a.area) ? b : a)).area);
    const boxes = outlines.map((p) => traced.box(p));
    const outer = outlines.map((p) => Math.sign(p.area) === sign || p.area === 0);
    const inWheels = outlines.map((_, i) => outer[i] && wheels.length > 0 && inWheel(boxes[i]));
    // A hole goes with the smallest outline round it: the outline (bigger than it) whose shape holds a point of the hole
    const inside = (q, x, y) => {
      if (x < q.minX || x > q.maxX || y < q.minY || y > q.maxY) return false;
      let odd = false;
      const pts = q.points;
      for (let k = 0, m = pts.length - 2; k < pts.length; m = k, k += 2) {
        const [xk, yk, xm, ym] = [pts[k], pts[k + 1], pts[m], pts[m + 1]];
        if (yk > y !== ym > y && x < ((xm - xk) * (y - yk)) / (ym - yk) + xk) odd = !odd;
      }
      return odd;
    };
    const toWheels = outlines.map((p, i) => {
      if (outer[i]) return inWheels[i];
      let parent = -1;
      for (let j = 0; j < outlines.length; j++) {
        if (!outer[j] || Math.abs(outlines[j].area) <= Math.abs(p.area)) continue;
        if (parent >= 0 && Math.abs(outlines[j].area) >= Math.abs(outlines[parent].area)) continue;
        if (inside(outlines[j], p.startX, p.startY)) parent = j;
      }
      return parent >= 0 && inWheels[parent];
    });
    const d = (list) => list.map((p) => `M${p.startX} ${p.startY}${p.body}`).join('');
    const b = outlines.filter((_, i) => !toWheels[i]);
    const w = outlines.filter((_, i) => toWheels[i]);
    if (b.length) body.push(d(b));
    if (w.length) wheel.push(d(w));
  }
  const chunk = (list) => list.map((dd) => `<path d="${dd}"/>`).join('\n');
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" data-car-id="${car.prefix}" data-view="${view}" data-projection="orthographic">`,
    `<title>${esc(title)}</title>`,
    `<desc>${esc(desc)}</desc>`,
    `<g id="body" transform="${traced.transform}" fill="${traced.fill}" stroke="none">`,
    chunk(body),
    '</g>',
    `<g id="wheels" transform="${traced.transform}" fill="${traced.fill}" stroke="none">`,
    chunk(wheel),
    '</g>',
    '</svg>',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(OUT, car.folder, `${car.prefix}-${view}.svg`), svg);
  return { body: body.length, wheels: wheel.length };
}

const report = [];
for (const car of CARS) {
  const anchorsIn = JSON.parse(fs.readFileSync(path.join(SOURCE, `${car.source}-anchors.json`), 'utf8'));
  const views = anchorsIn.views;
  fs.mkdirSync(path.join(OUT, car.folder), { recursive: true });
  for (const old of fs.readdirSync(path.join(OUT, car.folder))) fs.rmSync(path.join(OUT, car.folder, old));
  const file = (view) => path.join(SOURCE, `${car.source}_${view}.svg`);

  // Side views: measured. The left side faces screen-left (front wheel first), the right side screen-right
  const [lA, lB] = await measureSide(file('left-side'), views['left-side'].bbox, views['left-side'].ground_y);
  const [rA, rB] = await measureSide(file('right-side'), views['right-side'].bbox, views['right-side'].ground_y);
  const left = { front: lA, rear: lB };
  const right = { front: rB, rear: rA };
  // A source ground line can sit a little below the tires (a low splitter or diffuser line), which makes that side's
  // tires too big. Both sides are drawn at one scale, so each axle's tire radius (its wheel centre to the ground) is
  // the smaller of the two sides'
  for (const axle of ['front', 'rear']) {
    const r = Math.min(left[axle].r, right[axle].r);
    for (const w of [left[axle], right[axle]]) w.r = r;
  }

  // Scales: px per unit length in each view, against the left side's
  const side = views['left-side'].bbox;
  const top = views.top.bbox;
  const lengthScale = top.height / side.width; // top view px per side view px
  const widthScale = (view) => views[view].bbox.width / top.width; // a front or rear view's px per top view px
  const halfTrackTop = top.width * car.halfTrack;
  const topCx = top.x + top.width / 2;
  const sideToTopY = (x) => top.y + (x - side.x) * lengthScale;

  const out = {};
  const point = (x, y) => [r1(x), r1(y)];
  out['left-side'] = {
    orientation: { frontDirection: 'screen-left', up: 'vehicle up' },
    viewBox: [0, 0, W, H],
    anchors: {
      front_wheel_center: point(left.front.cx, left.front.cy),
      front_contact_patch: point(left.front.cx, left.front.cy + left.front.r),
      front_tyre_radius: left.front.r,
      rear_wheel_center: point(left.rear.cx, left.rear.cy),
      rear_contact_patch: point(left.rear.cx, left.rear.cy + left.rear.r),
      rear_tyre_radius: left.rear.r,
      groundY: r1((left.front.cy + left.front.r + left.rear.cy + left.rear.r) / 2),
    },
  };
  out['right-side'] = {
    orientation: { frontDirection: 'screen-right', up: 'vehicle up' },
    viewBox: [0, 0, W, H],
    anchors: {
      front_wheel_center: point(right.front.cx, right.front.cy),
      front_contact_patch: point(right.front.cx, right.front.cy + right.front.r),
      front_tyre_radius: right.front.r,
      rear_wheel_center: point(right.rear.cx, right.rear.cy),
      rear_contact_patch: point(right.rear.cx, right.rear.cy + right.rear.r),
      rear_tyre_radius: right.rear.r,
      groundY: r1((right.front.cy + right.front.r + right.rear.cy + right.rear.r) / 2),
    },
  };
  // Top: the front at screen-up, the car's left at screen-left
  const fy = sideToTopY(left.front.cx);
  const ry = sideToTopY(left.rear.cx);
  out.top = {
    orientation: { frontDirection: 'screen-up', vehicleLeft: 'screen-left', vehicleRight: 'screen-right' },
    viewBox: [0, 0, W, H],
    anchors: {
      front_left_wheel_center: point(topCx - halfTrackTop, fy),
      front_right_wheel_center: point(topCx + halfTrackTop, fy),
      rear_left_wheel_center: point(topCx - halfTrackTop, ry),
      rear_right_wheel_center: point(topCx + halfTrackTop, ry),
    },
  };
  // Front (seen from ahead: the car's right at screen-left) and rear (from behind: its left at screen-left)
  for (const view of ['front', 'rear']) {
    const v = views[view];
    const k = widthScale(view);
    const cx = v.bbox.x + v.bbox.width / 2;
    const half = halfTrackTop * k;
    // A side view px is lengthScale top px, and a top px k of this view's
    const r = (view === 'front' ? left.front.r : left.rear.r) * lengthScale * k;
    const cy = v.ground_y - r;
    const axle = view === 'front' ? 'front' : 'rear';
    const [first, second] = view === 'front' ? ['right', 'left'] : ['left', 'right'];
    out[view] = {
      orientation: view === 'front' ? { viewedFrom: 'ahead of the car', vehicleLeft: 'screen-right', vehicleRight: 'screen-left' } : { viewedFrom: 'behind the car', vehicleLeft: 'screen-left', vehicleRight: 'screen-right' },
      viewBox: [0, 0, W, H],
      anchors: {
        [`${axle}_${first}_wheel_center`]: point(cx - half, cy),
        [`${axle}_${first}_contact_patch`]: point(cx - half, v.ground_y),
        [`${axle}_${second}_wheel_center`]: point(cx + half, cy),
        [`${axle}_${second}_contact_patch`]: point(cx + half, v.ground_y),
        groundY: v.ground_y,
      },
    };
  }

  const s = anchorsIn.source;
  const license = String(s.licence ?? '').split(' ')[0];
  const credit = `“${s.model_title}” by ${s.author}${s.url ? ` (${s.url})` : ''}, ${license}`;
  const counts = {};
  for (const view of ['left-side', 'right-side', 'top', 'front', 'rear']) {
    const traced = readTraced(file(view));
    const a = out[view].anchors;
    // Only the side views' wheels were measured, so only theirs are split out
    const wheels =
      view === 'left-side' ? [left.front, left.rear] : view === 'right-side' ? [right.front, right.rear] : [];
    counts[view] = writeSvg(car, view, traced, wheels, `${anchorsIn.name} — ${view} (orthographic, traced)`, `Traced from a render of ${credit}.`);
    void a;
  }

  fs.writeFileSync(
    path.join(OUT, car.folder, `${car.prefix}-anchors.json`),
    JSON.stringify(
      {
        car_id: car.prefix,
        car_name: anchorsIn.name,
        status: 'draft',
        projection: 'orthographic',
        units: `px of a ${W}x${H} render (not to scale; each view fitted to its canvas)`,
        source: { title: s.model_title, author: s.author, license, url: s.url },
        scaling: 'Traced (potrace) from 2400x1400 renders of the model; each view scaled to fit its canvas',
        views: out,
      },
      null,
      2
    ) + '\n'
  );
  report.push({ car: car.folder, left, right, counts, credit, license });
  // With DEBUG_DIR set, the side views with the measured wheels drawn over them, to check by eye
  if (process.env.DEBUG_DIR) {
    for (const [view, pair] of [['left-side', [left.front, left.rear]], ['right-side', [right.front, right.rear]]]) {
      const marks = pair.map((w) => `<circle cx="${w.cx}" cy="${w.cy}" r="${w.r}" fill="none" stroke="#ff3b3b" stroke-width="4"/><circle cx="${w.cx}" cy="${w.cy}" r="8" fill="#ff3b3b"/>`).join('');
      const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${marks}</svg>`);
      const full = await sharp(file(view), { density: 72 }).resize(W, H, { fit: 'fill' }).flatten({ background: '#15181c' }).composite([{ input: overlay }]).png().toBuffer();
      await sharp(full).resize(1200, 700).png().toFile(path.join(process.env.DEBUG_DIR, `${car.folder}-${view}.png`));
    }
  }
  console.log(
    `${car.folder}: left side front r ${left.front.r} at ${left.front.cx},${left.front.cy} (${Math.round(left.front.hits * 100)}% on ink), rear r ${left.rear.r} at ${left.rear.cx},${left.rear.cy} (${Math.round(left.rear.hits * 100)}%); right side front r ${right.front.r} (${Math.round(right.front.hits * 100)}%), rear r ${right.rear.r} (${Math.round(right.rear.hits * 100)}%); wheels split ${counts['left-side'].wheels}/${counts['right-side'].wheels} outlines`
  );
}

// The notes: the source's model review and licence warnings, and what this conversion measured and estimated
const sourceNotes = fs.readFileSync(path.join(SOURCE, 'VALIDATION-NOTES.md'), 'utf8');
for (const r of report) {
  const pct = (w) => `${Math.round(w.hits * 100)}%`;
  const notes = [
    `# Validation notes: ${r.car}`,
    '',
    `Traced drawings from the Lovable project darinlutz/five-more-fast-cars, converted by scripts/importTracedCarDrawings.mjs.`,
    `Model: ${r.credit}.`,
    '',
    '## Anchors',
    `- Side views: wheel centres, radii and contact patches measured from the drawings (the circle on the ground line most drawn pixels lie on; left side ${pct(r.left.front)} and ${pct(r.left.rear)} of its points on lines, right side ${pct(r.right.front)} and ${pct(r.right.rear)}). Their tire and rim outlines are in the wheels layer.`,
    '- Top, front and rear views: wheel centres ESTIMATED from the side view through each view\'s scale and a half track that is a share of the car\'s width, as these views hide or crop the tires. Their wheels stay in the body layer. Check them with the SVG debug switch before activating.',
    '- No ride height reference points, splitter, diffuser or wing anchors.',
    '- Not to scale: each view was fitted to its own 2400x1400 canvas.',
    '',
    '## From the source project (please review)',
    sourceNotes.split('\n').filter((l) => l.startsWith('|') || /NonCommercial|NC\)|CC-BY requires/.test(l)).join('\n'),
    '',
  ].join('\n');
  fs.writeFileSync(path.join(OUT, r.car, 'VALIDATION-NOTES.md'), notes);
}
