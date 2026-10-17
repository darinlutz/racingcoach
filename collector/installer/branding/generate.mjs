// Renders the installer's branding (collector/installer/RacingCoach.Collector.iss) from the RacingCoach.app logo:
//   wizard-<w>x<h>.png  the Welcome and Finish pages' left panel, one per Windows display scale (Inno Setup picks
//                       the closest, so nothing is scaled up and blurred)
//   header-<n>.png      the flag badge at the top right of the other pages, likewise
// The logo is the site's (src/components/Brand.tsx): the red lucide Flag and RACINGCOACH.APP in Barlow Condensed,
// with the tagline. wordmark.svg and tagline.svg are that text already turned into outlines, so no fonts are
// needed; colors.json is the site's dark theme (src/app/globals.css). The PNGs are committed, so CI doesn't run
// this; run it again after changing the logo:
//   node collector/installer/branding/generate.mjs
// (sharp comes with Next.js in node_modules.)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const dir = path.dirname(fileURLToPath(import.meta.url));
const colors = JSON.parse(fs.readFileSync(path.join(dir, 'colors.json'), 'utf8'));

// lucide-react's Flag (the site's nav and favicon, src/app/icon.svg), drawn in a 24x24 box
const FLAG =
  'M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528';

// An outlined SVG's viewBox and inner markup, to place it inside another SVG
function part(name) {
  const svg = fs.readFileSync(path.join(dir, name), 'utf8');
  const [, minX, minY, w, h] = svg.match(/viewBox="([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)"/).map(Number);
  const inner = svg.slice(svg.indexOf('>', svg.indexOf('<svg')) + 1, svg.lastIndexOf('</svg>'));
  return { minX, minY, w, h, inner };
}
const wordmark = part('wordmark.svg');
const tagline = part('tagline.svg');

// Places a part with its left edge at x, top at y, scaled to the given width
function place({ minX, minY, w, h, inner }, x, y, width) {
  const height = (h * width) / w;
  return `<svg x="${x}" y="${y}" width="${width}" height="${height}" viewBox="${minX} ${minY} ${w} ${h}">${inner}</svg>`;
}

const flag = (x, y, size, color = colors.primary) =>
  `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 24 24"><path d="${FLAG}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// The left panel, laid out on Inno Setup's 164x314 grid (its aspect ratio at every scale): the flag large, the
// wordmark and tagline centered under it, on the site's dark background with a faint red glow behind the flag
function wizardSvg() {
  const W = 164, H = 314;
  const flagSize = 60;
  const markWidth = 136;
  const markHeight = (wordmark.h * markWidth) / wordmark.w;
  const tagWidth = (tagline.w * markWidth) / wordmark.w;
  const flagY = 92;
  const markY = flagY + flagSize + 22;
  const tagY = markY + markHeight + 7;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${colors.background}"/>
      <stop offset="1" stop-color="${colors.heroShade}"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.39" r="0.42" gradientTransform="translate(0.5 0.39) scale(1 0.55) translate(-0.5 -0.39)">
      <stop offset="0" stop-color="${colors.primary}" stop-opacity="0.22"/>
      <stop offset="1" stop-color="${colors.primary}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#shade)"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
  ${flag((W - flagSize) / 2, flagY, flagSize)}
  ${place(wordmark, (W - markWidth) / 2, markY, markWidth)}
  ${place(tagline, (W - tagWidth) / 2, tagY, tagWidth)}
  <rect x="${(W - 28) / 2}" y="${H - 34}" width="28" height="2" rx="1" fill="${colors.primary}"/>
</svg>`;
}

// The header badge: the flag on a dark rounded square, like the app icon (RacingCoach.Collector/Assets/collector.ico),
// with a transparent outside so it suits the wizard's light and dark modes
function headerSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 58 58">
  <rect x="1" y="1" width="56" height="56" rx="12" fill="${colors.card}" stroke="${colors.border}" stroke-width="1.5"/>
  ${flag(13, 13, 32)}
</svg>`;
}

// Inno Setup 6.6+'s image areas at 100%, 125%, 150%, 175%, 200%, 225% and 250% (WizardImageFile's help topic);
// the wide sizes keep the 164:314 aspect ratio
const WIZARD_HEIGHTS = [386, 515, 643, 772, 824, 953, 1022];
const HEADER_SIZES = [58, 73, 87, 102, 116, 131, 145];

// Inno Setup 6.7 draws pixels of exactly this color see-through (its wizard's transparency key), so the dark
// background's gradient must never land on it: such pixels are moved one step in blue
const KEY = [13, 11, 12];

async function render(svg, width, height, file, opaque) {
  // density: rasterize the vector at the output size, not a small bitmap scaled up
  const density = Math.ceil((72 * height) / Number(svg.match(/viewBox="0 0 [\d.]+ ([\d.]+)"/)[1]));
  let image = sharp(Buffer.from(svg), { density }).resize(width, height, { fit: 'fill' });
  // The panel has no see-through parts, so it needs no alpha channel
  if (opaque) image = image.flatten({ background: colors.background }).removeAlpha();
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  let moved = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    if (data[i] === KEY[0] && data[i + 1] === KEY[1] && data[i + 2] === KEY[2]) {
      data[i + 2]++;
      moved++;
    }
  }
  await sharp(data, { raw: info }).png({ compressionLevel: 9 }).toFile(path.join(dir, file));
  console.log(file + (moved ? ` (${moved} pixels moved off the transparency key)` : ''));
}

for (const height of WIZARD_HEIGHTS) {
  const width = Math.round((height * 164) / 314);
  await render(wizardSvg(), width, height, `wizard-${width}x${height}.png`, true);
}
for (const size of HEADER_SIZES) {
  await render(headerSvg(), size, size, `header-${size}.png`, false);
}
