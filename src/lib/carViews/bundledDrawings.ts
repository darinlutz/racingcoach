import fs from 'node:fs/promises';
import path from 'node:path';
import { lovableViewAnchors, withLovableLayers, type LovableView } from './lovableImport.ts';
import { ASSET_LIMITS } from './assetRules.ts';
import { CAR_VIEWS, type CarView } from './views.ts';

// The engineering car drawings kept in the repository (data/car-drawings/, from the Lovable project
// darinlutz/racingcoach-car-drawings; docs/car-views.md), which the Admin page imports as draft versions. Read from
// disk on the server only (the Dockerfile copies the folder beside the standalone server). An import is an ordinary
// draft: it goes through validateDraft and the review like an upload, and drivers see nothing until it's activated.

export type BundledDrawing = {
  id: string;
  // Car Data's name for the car, to suggest which car to import it for (the Admin chooses)
  carName: string;
  // iRacing's car paths for the car (IRACING_CARS in carPictures.ts), matched exactly
  carKeys: string[];
  folder: string;
  prefix: string;
};

export const BUNDLED_DRAWINGS: BundledDrawing[] = [
  { id: 'huracan-gt3-evo', carName: 'Lamborghini Huracan GT3 EVO', carKeys: ['lamborghinievogt3'], folder: 'huracan-gt3-evo', prefix: 'lamborghini-huracan-gt3-evo' },
  { id: 'ferrari-296-gt3', carName: 'Ferrari 296 GT3', carKeys: ['ferrari296gt3'], folder: 'ferrari-296-gt3', prefix: 'ferrari-296-gt3' },
];

// The Lovable repository's commit the drawings were copied from
export const BUNDLED_DRAWINGS_COMMIT = 'a31b2ec';

const root = () => path.join(process.cwd(), 'data', 'car-drawings');

type AnchorsFile = {
  car_name?: string;
  status?: string;
  source?: { title?: string; author?: string; license?: string; url?: string };
  scaling?: string;
  views?: Partial<Record<CarView, LovableView>>;
};

export type BundledSummary = { id: string; carName: string; carKeys: string[]; views: CarView[]; credit: string; license: string; status: string };

async function readSet(set: BundledDrawing) {
  const dir = path.join(root(), set.folder);
  const anchors = JSON.parse(await fs.readFile(path.join(dir, `${set.prefix}-anchors.json`), 'utf8')) as AnchorsFile;
  const notes = await fs.readFile(path.join(dir, 'VALIDATION-NOTES.md'), 'utf8').catch(() => '');
  const s = anchors.source ?? {};
  const credit = `“${s.title ?? set.carName}” by ${s.author ?? 'unknown'}${s.url ? ` (${s.url})` : ''}`;
  return { dir, anchors, notes, credit, license: s.license ?? '' };
}

export async function listBundledDrawings(): Promise<BundledSummary[]> {
  const out: BundledSummary[] = [];
  for (const set of BUNDLED_DRAWINGS) {
    try {
      const { dir, anchors, credit, license } = await readSet(set);
      const files = await fs.readdir(dir);
      const views = CAR_VIEWS.filter((v) => files.includes(`${set.prefix}-${v}.svg`) && anchors.views?.[v]);
      out.push({ id: set.id, carName: anchors.car_name ?? set.carName, carKeys: set.carKeys, views, credit, license, status: anchors.status ?? '' });
    } catch (error) {
      console.error(`Car drawings ${set.id} couldn't be read:`, error);
    }
  }
  return out;
}

// The draft input for validateDraft (assetRules.ts): every view's SVG with its layers tagged, and its anchors in this
// site's format; the sources, licence and the drawings' own validation notes as the version's approximations
export async function bundledDraftInput(id: string, carId: number, carKeys?: string[]): Promise<Record<string, unknown> | null> {
  const set = BUNDLED_DRAWINGS.find((s) => s.id === id);
  if (!set) return null;
  const { dir, anchors, notes, credit, license } = await readSet(set);
  const views: Record<string, unknown> = {};
  for (const view of CAR_VIEWS) {
    const source = anchors.views?.[view];
    if (!source) continue;
    const svg = await fs.readFile(path.join(dir, `${set.prefix}-${view}.svg`), 'utf8').catch(() => null);
    if (!svg) continue;
    views[view] = { svg: withLovableLayers(svg), anchors: lovableViewAnchors(view, source), hasWheels: true };
  }
  const sources = [
    `Drawn from the 3D model ${credit}, licensed ${license || 'under an unknown licence'}.`,
    `Orthographic feature-edge drawings from the Lovable project darinlutz/racingcoach-car-drawings (commit ${BUNDLED_DRAWINGS_COMMIT}). ${anchors.scaling ?? ''}`.trim(),
  ].join('\n');
  return {
    carId,
    carKeys: carKeys?.length ? carKeys : set.carKeys,
    views,
    sources,
    license: license ? `${license}: credit ${credit}` : '',
    notes: notes.slice(0, ASSET_LIMITS.notes),
  };
}

// Car Data's car for a set, by its name with accents, case and punctuation ignored: only a suggestion for the Admin's
// choice, never how setups are matched (that's the exact car paths)
export const nameKey = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
