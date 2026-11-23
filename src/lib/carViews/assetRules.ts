// The engineering car drawings' rules (docs/car-views.md): what an Admin's upload must be, how a version moves from
// draft to active, and which drawing a page shows. Pure, no I/O; carViewStore.ts keeps them in the database.
//
// A car's drawings are one version of up to five views, tied to Car Data's car (its id) and to the iRacing car paths
// (CarPath, e.g. lamborghinievogt3) of the setups it's for, matched exactly, never by a similar name. A version is a
// draft, then under review, then approved or rejected; an approved version with its sources and licence recorded can
// be made the car's active one, which is the only one drivers see. A view the active version hasn't got, and every
// car without one, shows the generic car, labelled as such: never another car's drawing.

import { parseViewAnchors, type AnchorProblem, type CarViewArt } from './anchors.ts';
import { genericArt } from './genericVehicle.ts';
import { sanitizeSvg, type SvgProblem } from './svgSanitize.ts';
import { CAR_VIEWS, isCarView, type CarView } from './views.ts';

export const ASSET_STATUSES = ['draft', 'under_review', 'approved', 'rejected'] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];
export const ASSET_ACTIONS = ['submit', 'approve', 'reject', 'activate', 'deactivate'] as const;
export type AssetAction = (typeof ASSET_ACTIONS)[number];

export const ASSET_LIMITS = { carKeys: 10, sharedCars: 20, sources: 4000, license: 1000, notes: 4000 } as const;

// The other Car Data cars a version is shared with (its drawings or 3D model used for them too): distinct positive
// ids, never the version's own car, at most ASSET_LIMITS.sharedCars. Drivers' pages still find a version only by its
// car paths, so each shared car's car paths go in carKeys too. Null when the value isn't a list of car ids
export function parseSharedCarIds(value: unknown, ownCarId: number | null): number[] | null {
  if (value === undefined || value === null) return [];
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',').filter((v) => v.trim()) : null;
  if (!raw) return null;
  const ids: number[] = [];
  for (const v of raw) {
    const id = typeof v === 'number' ? v : Number(String(v).trim());
    if (!Number.isInteger(id) || id <= 0) return null;
    if (id !== ownCarId && !ids.includes(id)) ids.push(id);
  }
  return ids.length > ASSET_LIMITS.sharedCars ? null : ids;
}

// The status each action moves a version to (activate and deactivate change only which version is active)
const NEXT: Record<'submit' | 'approve' | 'reject', [AssetStatus, AssetStatus]> = {
  submit: ['draft', 'under_review'],
  approve: ['under_review', 'approved'],
  reject: ['under_review', 'rejected'],
};

export type ActionCheck = { ok: true; status: AssetStatus } | { ok: false; code: 'wrongStatus' | 'needsProvenance' | 'notActive' | 'alreadyActive' };

export function checkAction(
  version: { status: AssetStatus; active: boolean; sources: string; license: string },
  action: AssetAction
): ActionCheck {
  if (action === 'activate') {
    if (version.status !== 'approved') return { ok: false, code: 'wrongStatus' };
    if (version.active) return { ok: false, code: 'alreadyActive' };
    if (!version.sources.trim() || !version.license.trim()) return { ok: false, code: 'needsProvenance' };
    return { ok: true, status: 'approved' };
  }
  if (action === 'deactivate') return version.active ? { ok: true, status: version.status } : { ok: false, code: 'notActive' };
  const [from, to] = NEXT[action];
  return version.status === from ? { ok: true, status: to } : { ok: false, code: 'wrongStatus' };
}

// iRacing's car path, as session info's CarPath and the setups' car_key give it
// iRacing's car path: some have a folder and a space in them ("mx5 mx52016", "stockcars chevycamarozl12022"), which
// setups carry as they are, so a single space between words is allowed
export const CAR_KEY = /^(?=.{2,64}$)[a-z0-9][a-z0-9_.-]*(?: [a-z0-9_.-]+)*$/;
export const normalizeCarKey = (key: string) => key.trim().toLowerCase();

export type ViewInput = { svg: string; anchors: unknown; hasWheels?: unknown };
export type DraftProblem =
  | { code: 'car' }
  | { code: 'carKeys' }
  | { code: 'carKey'; key: string }
  | { code: 'sharedCars' }
  | { code: 'noViews' }
  | { code: 'unknownView'; view: string }
  | { code: 'tooLong'; field: 'sources' | 'license' | 'notes' }
  | { code: 'svg'; view: CarView; problem: SvgProblem }
  | { code: 'anchors'; view: CarView; problem: AnchorProblem };

export type DraftViews = Partial<Record<CarView, CarViewArt>>;
export type Draft = { carId: number; sharedCarIds: number[]; carKeys: string[]; views: DraftViews; sources: string; license: string; notes: string };

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

// An Admin's new version, checked whole: every view sanitized (svgSanitize.ts) and its anchors checked against the
// view's orientation (anchors.ts). Nothing is saved while anything is wrong
export function validateDraft(raw: unknown): { ok: true; draft: Draft } | { ok: false; problems: DraftProblem[] } {
  const problems: DraftProblem[] = [];
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const carId = typeof r.carId === 'number' && Number.isInteger(r.carId) && r.carId > 0 ? r.carId : null;
  if (!carId) problems.push({ code: 'car' });
  const keys = Array.isArray(r.carKeys) ? [...new Set(r.carKeys.filter((k): k is string => typeof k === 'string').map(normalizeCarKey).filter(Boolean))] : [];
  if (!keys.length || keys.length > ASSET_LIMITS.carKeys) problems.push({ code: 'carKeys' });
  for (const key of keys) if (!CAR_KEY.test(key)) problems.push({ code: 'carKey', key });
  const sharedCarIds = parseSharedCarIds(r.sharedCarIds, carId);
  if (!sharedCarIds) problems.push({ code: 'sharedCars' });
  const views: DraftViews = {};
  const input = (r.views && typeof r.views === 'object' ? r.views : {}) as Record<string, unknown>;
  for (const [name, value] of Object.entries(input)) {
    if (!isCarView(name)) {
      problems.push({ code: 'unknownView', view: name.slice(0, 40) });
      continue;
    }
    if (!value || typeof value !== 'object') continue;
    const v = value as ViewInput;
    if (typeof v.svg !== 'string' || !v.svg.trim()) continue;
    const sanitized = sanitizeSvg(v.svg);
    if (!sanitized.ok) {
      for (const problem of sanitized.problems) problems.push({ code: 'svg', view: name, problem });
      continue;
    }
    const { anchors, problems: anchorProblems } = parseViewAnchors(name, v.anchors);
    for (const problem of anchorProblems) problems.push({ code: 'anchors', view: name, problem });
    views[name] = { viewBox: sanitized.svg.viewBox, inner: sanitized.svg.inner, anchors, hasWheels: v.hasWheels !== false };
  }
  if (!Object.keys(views).length && !problems.some((p) => p.code === 'svg')) problems.push({ code: 'noViews' });
  const sources = text(r.sources);
  const license = text(r.license);
  const notes = text(r.notes);
  if (sources.length > ASSET_LIMITS.sources) problems.push({ code: 'tooLong', field: 'sources' });
  if (license.length > ASSET_LIMITS.license) problems.push({ code: 'tooLong', field: 'license' });
  if (notes.length > ASSET_LIMITS.notes) problems.push({ code: 'tooLong', field: 'notes' });
  if (problems.length || !carId || !sharedCarIds) return { ok: false, problems };
  return { ok: true, draft: { carId, sharedCarIds, carKeys: keys, views, sources, license, notes } };
}

// Which cars use a version, changed at any status (it doesn't change what was reviewed): the other cars it's shared
// with and the car paths drivers' pages find it by
export type Sharing = { sharedCarIds: number[]; carKeys: string[] };

export type SharingProblem = { code: 'carKeys' } | { code: 'carKey'; key: string } | { code: 'sharedCars' };

export function validateSharing(raw: unknown, ownCarId: number): { ok: true; sharing: Sharing } | { ok: false; problems: SharingProblem[] } {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const problems: SharingProblem[] = [];
  const list = Array.isArray(r.carKeys) ? r.carKeys : typeof r.carKeys === 'string' ? r.carKeys.split(/[,\n]+/) : [];
  const keys = [...new Set(list.filter((k): k is string => typeof k === 'string').map(normalizeCarKey).filter(Boolean))];
  if (!keys.length || keys.length > ASSET_LIMITS.carKeys) problems.push({ code: 'carKeys' });
  for (const key of keys) if (!CAR_KEY.test(key)) problems.push({ code: 'carKey', key });
  const sharedCarIds = parseSharedCarIds(r.sharedCarIds, ownCarId);
  if (!sharedCarIds) problems.push({ code: 'sharedCars' });
  if (problems.length || !sharedCarIds) return { ok: false, problems };
  return { ok: true, sharing: { sharedCarIds, carKeys: keys } };
}

// What a page is given for a car: its active version's drawings, or null when it has none
export type ResolvedCarAsset = {
  id: number;
  version: number;
  carId: number;
  carName: string;
  status: AssetStatus;
  active: boolean;
  views: DraftViews;
  // What the drawings' author says is approximate about them
  notes: string;
};

export type ViewSource = 'approved' | 'preview' | 'generic';
export type ResolvedView = { art: CarViewArt; source: ViewSource; reason: 'noAsset' | 'missingView' | null };

// The drawing a page shows for one view: the car's own when its asset has that view (an active one, or any version
// an Admin previews), else the generic car with the reason
export function resolveView(asset: ResolvedCarAsset | null, view: CarView): ResolvedView {
  const own = asset?.views[view];
  if (asset && own) return { art: own, source: asset.active ? 'approved' : 'preview', reason: null };
  return { art: genericArt(view), source: 'generic', reason: asset ? 'missingView' : 'noAsset' };
}

export const viewCoverage = (views: DraftViews): CarView[] => CAR_VIEWS.filter((v) => !!views[v]);
