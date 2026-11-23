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
  // The Lovable repository's commit the set was copied from
  commit: string;
  // That repository, when not darinlutz/racingcoach-car-drawings (traced drawings converted by
  // scripts/importTracedCarDrawings.mjs)
  project?: string;
  // Permission beyond the model's own licence, recorded with the licence when the set is imported
  permission?: string;
};

export const BUNDLED_DRAWINGS: BundledDrawing[] = [
  { id: 'huracan-gt3-evo', carName: 'Lamborghini Huracan GT3 EVO', carKeys: ['lamborghinievogt3'], folder: 'huracan-gt3-evo', prefix: 'lamborghini-huracan-gt3-evo', commit: 'a31b2ec' },
  // The traced set from darinlutz/five-more-fast-cars, redrawn there from MattDoesBlender's replacement model (commit
  // 73beefe, CC-BY-NC-SA-4.0); the earlier sets (bf0668b of that project, a31b2ec of racingcoach-car-drawings) are in
  // git history
  { id: 'ferrari-296-gt3', carName: 'Ferrari 296 GT3', carKeys: ['ferrari296gt3'], folder: 'ferrari-296-gt3', prefix: 'ferrari-296-gt3', commit: '73beefe', project: 'darinlutz/five-more-fast-cars' },
  { id: 'corvette-z06-gt3r', carName: 'Chevrolet Corvette Z06 GT3.R', carKeys: ['chevyvettez06rgt3'], folder: 'corvette-z06-gt3r', prefix: 'corvette-z06-gt3r', commit: 'edea872', permission: 'The model’s author granted RacingCoach.app permission to use it on the site, a commercial use its CC BY-NC-SA licence alone wouldn’t allow (2026-11-19).' },
  { id: 'ford-mustang-gt3', carName: 'Ford Mustang GT3', carKeys: ['fordmustanggt3'], folder: 'ford-mustang-gt3', prefix: 'ford-mustang-gt3', commit: 'edea872' },
  { id: 'acura-nsx-gt3-evo', carName: 'Acura NSX GT3 EVO 22', carKeys: ['acuransxevo22gt3'], folder: 'acura-nsx-gt3-evo', prefix: 'acura-nsx-gt3-evo', commit: '6be3c65' },
  { id: 'aston-martin-vantage-gt3-evo', carName: 'Aston Martin Vantage GT3 EVO', carKeys: ['amvantageevogt3'], folder: 'aston-martin-vantage-gt3-evo', prefix: 'aston-martin-vantage-gt3-evo', commit: '6be3c65' },
  { id: 'audi-r8-lms-evo-ii-gt3', carName: 'Audi R8 LMS EVO II GT3', carKeys: ['audir8lmsevo2gt3'], folder: 'audi-r8-lms-evo-ii-gt3', prefix: 'audi-r8-lms-evo-ii-gt3', commit: '6be3c65' },
  { id: 'bmw-m4-gt3-evo', carName: 'BMW M4 GT3 EVO', carKeys: ['bmwm4gt3'], folder: 'bmw-m4-gt3-evo', prefix: 'bmw-m4-gt3-evo', commit: '6be3c65' },
  { id: 'mclaren-720s-gt3-evo', carName: 'McLaren 720S GT3 EVO', carKeys: ['mclaren720sgt3'], folder: 'mclaren-720s-gt3-evo', prefix: 'mclaren-720s-gt3-evo', commit: '6be3c65' },
  { id: 'mercedes-amg-gt3-evo-2020', carName: 'Mercedes-AMG GT3 2020', carKeys: ['mercedesamgevogt3'], folder: 'mercedes-amg-gt3-evo-2020', prefix: 'mercedes-amg-gt3-evo-2020', commit: '6be3c65' },
  { id: 'porsche-911-gt3-r-992', carName: 'Porsche 911 GT3 R (992)', carKeys: ['porsche992rgt3'], folder: 'porsche-911-gt3-r-992', prefix: 'porsche-911-gt3-r-992', commit: '6be3c65' },
  // Traced from darinlutz/five-more-fast-cars (scripts/importTracedCarDrawings.mjs); each set's VALIDATION-NOTES.md says
  // what was measured and what estimated, and its model and licence. The Toyota GR86 and Mazda MX-5 are NonCommercial
  // models (so is this project's Ferrari, above), imported now with their licences recorded as they are: the owner is
  // getting their authors' permission afterwards
  { id: 'toyota-gr86', carName: 'Toyota GR86', carKeys: ['toyotagr86'], folder: 'toyota-gr86', prefix: 'toyota-gr86', commit: 'bf0668b', project: 'darinlutz/five-more-fast-cars' },
  // The Mazda MX-5 Cup (from a 2019 road car's model, see its notes), for the setups folder the owner has, the Global
  // Mazda MX-5 Cup's (mx5 mx52016)
  { id: 'mazda-mx5-cup', carName: 'Global Mazda MX-5 Cup', carKeys: ['mx5 mx52016'], folder: 'mazda-mx5-cup', prefix: 'mazda-mx5-cup', commit: 'bf0668b', project: 'darinlutz/five-more-fast-cars' },
  { id: 'nascar-camaro-zl1-next-gen', carName: 'Next Gen NASCAR Cup Series Chevrolet Camaro ZL1', carKeys: ['stockcars chevycamarozl12022'], folder: 'nascar-camaro-zl1-next-gen', prefix: 'nascar-camaro-zl1-next-gen', commit: 'bf0668b', project: 'darinlutz/five-more-fast-cars' },
  { id: 'mercedes-amg-f1', carName: 'Mercedes-AMG W13 E Performance', carKeys: ['mercedesw13'], folder: 'mercedes-amg-f1', prefix: 'mercedes-amg-f1', commit: 'bf0668b', project: 'darinlutz/five-more-fast-cars' },
  // Four prototypes added there on 2026-11-23 (commit 9c60a5a; uploaded as daytona-prototype, lmp1, lmp2 and
  // spec-racer), each named after the model it was drawn from and suggesting iRacing's car of that model, or the nearest:
  // the 2015 Ford-Riley DP is a Riley chassis, so iRacing's Riley MkXX Daytona Prototype; the Porsche 919 Hybrid (CC
  // BY-NC-SA, like the Toyota and Mazda above) the Porsche 919 LMP1; the Porsche 963 LMDh the Porsche 963 GTP; and the HPD
  // ARX-03B, which iRacing doesn't have, its predecessor the HPD ARX-01c. Share them with other prototypes (Also used by)
  { id: 'ford-riley-daytona-prototype', carName: 'Riley MkXX Daytona Prototype', carKeys: ['rileydp'], folder: 'ford-riley-daytona-prototype', prefix: 'ford-riley-daytona-prototype', commit: '9c60a5a', project: 'darinlutz/five-more-fast-cars' },
  { id: 'porsche-919-hybrid', carName: 'Porsche 919 LMP1',carKeys: ['porsche919'], folder: 'porsche-919-hybrid', prefix: 'porsche-919-hybrid', commit: '9c60a5a', project: 'darinlutz/five-more-fast-cars' },
  { id: 'porsche-963-gtp', carName: 'Porsche 963 GTP', carKeys: ['porsche963gtp'], folder: 'porsche-963-gtp', prefix: 'porsche-963-gtp', commit: '9c60a5a', project: 'darinlutz/five-more-fast-cars' },
  { id: 'hpd-arx-03b', carName: 'HPD ARX-01c', carKeys: ['hpdarx01c'], folder: 'hpd-arx-03b', prefix: 'hpd-arx-03b', commit: '9c60a5a', project: 'darinlutz/five-more-fast-cars' },
];

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
    `Orthographic ${set.project ? 'traced ' : 'feature-edge '}drawings from the Lovable project ${set.project ?? 'darinlutz/racingcoach-car-drawings'} (commit ${set.commit}). ${anchors.scaling ?? ''}`.trim(),
  ].join('\n');
  return {
    carId,
    carKeys: carKeys?.length ? carKeys : set.carKeys,
    views,
    sources,
    license: license ? `${license}: credit ${credit}${set.permission ? `. ${set.permission}` : ''}` : '',
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
