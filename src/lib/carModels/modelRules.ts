// The 3D car models' rules (docs/car-models.md): what an Admin's upload and settings must be, how a version moves from
// uploaded to active, and what a page is told about a car. Pure, no I/O; carModelStore.ts keeps them in the database.
//
// Like the engineering car drawings (carViews/assetRules.ts, whose car path rule this shares), a model is one version
// tied to Car Data's car (its id) and to the exact iRacing car paths (CarPath, e.g. lamborghinievogt3) it's for, never a
// similar name: the Huracán GT3, GT3 EVO and EVO2 are three cars and never share a model by accident. A car path belongs
// to one car's active model. A version is uploaded (checked by glb.ts and stored), then ready for review, then approved
// or rejected; an approved version with its source and licence (and the author's credit, for a licence that asks for
// one) can be made the car's active one, the only one drivers see. Every car without one shows the generic car,
// labelled as such: never another car's model. "Missing" isn't stored: it's a car with no version at all.

import { CAR_KEY, normalizeCarKey } from '../carViews/assetRules.ts';
import { AXES, DEFAULT_NORMALIZATION, validAxes, type Axis, type Bounds, type Normalization, type Vec3 } from './matrix.ts';

export const MODEL_STATUSES = ['uploaded', 'ready_for_review', 'approved', 'rejected'] as const;
export type ModelStatus = (typeof MODEL_STATUSES)[number];
export const MODEL_ACTIONS = ['submit', 'approve', 'reject', 'activate', 'deactivate'] as const;
export type ModelAction = (typeof MODEL_ACTIONS)[number];

export const MODEL_LIMITS = { carKeys: 10, source: 4000, license: 1000, attribution: 1000, notes: 4000, fileName: 200 } as const;

// The camera presets of every viewer, and which one a model opens with
export const CAMERA_VIEWS = ['frontThreeQuarter', 'rearThreeQuarter', 'front', 'rear', 'left', 'right', 'top'] as const;
export type CameraView = (typeof CAMERA_VIEWS)[number];
export const isCameraView = (v: unknown): v is CameraView => typeof v === 'string' && (CAMERA_VIEWS as readonly string[]).includes(v);

export const CORNERS = ['LF', 'RF', 'LR', 'RR'] as const;
export type Corner = (typeof CORNERS)[number];
// A wheel center in the canonical frame (meters), and whether a person has checked it against the model
export type WheelAnchor = { x: number; y: number; z: number; verified: boolean };
export type WheelAnchors = Record<Corner, WheelAnchor>;

const NEXT: Record<'submit' | 'approve' | 'reject', [ModelStatus[], ModelStatus]> = {
  submit: [['uploaded'], 'ready_for_review'],
  approve: [['ready_for_review'], 'approved'],
  reject: [['ready_for_review'], 'rejected'],
};

// Creative Commons BY licences (any variant) ask for the author's credit where the work is shown
export const needsAttribution = (license: string) => /\bCC[\s-]*BY\b/i.test(license);
// A NonCommercial licence may not allow use on a paid site: shown as a warning beside the version, never decided here
export const nonCommercial = (license: string) => /\bNC\b|non-?commercial/i.test(license);

export type ModelActionCheck =
  | { ok: true; status: ModelStatus }
  | { ok: false; code: 'wrongStatus' | 'needsProvenance' | 'needsAttribution' | 'notActive' | 'alreadyActive' };

export function checkModelAction(
  version: { status: ModelStatus; active: boolean; source: string; license: string; attribution: string },
  action: ModelAction
): ModelActionCheck {
  if (action === 'activate') {
    if (version.status !== 'approved') return { ok: false, code: 'wrongStatus' };
    if (version.active) return { ok: false, code: 'alreadyActive' };
    if (!version.source.trim() || !version.license.trim()) return { ok: false, code: 'needsProvenance' };
    if (needsAttribution(version.license) && !version.attribution.trim()) return { ok: false, code: 'needsAttribution' };
    return { ok: true, status: 'approved' };
  }
  if (action === 'deactivate') return version.active ? { ok: true, status: version.status } : { ok: false, code: 'notActive' };
  const [from, to] = NEXT[action];
  return from.includes(version.status) ? { ok: true, status: to } : { ok: false, code: 'wrongStatus' };
}

// Settings can be changed while a version is uploaded or rejected (a change to a rejected one sends it back to
// uploaded, to be submitted again); once it's ready for review or approved what was reviewed is what drivers get
export const editableStatus = (status: ModelStatus) => status === 'uploaded' || status === 'rejected';

export type ModelProblem =
  | { code: 'car' }
  | { code: 'carKeys' }
  | { code: 'carKey'; key: string }
  | { code: 'sharedCars' }
  | { code: 'tooLong'; field: 'source' | 'license' | 'attribution' | 'notes' }
  | { code: 'normalization' }
  | { code: 'wheelAnchors' }
  | { code: 'defaultView' };

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const finite = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

export function parseCarKeys(value: unknown): { keys: string[]; problems: ModelProblem[] } {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,\n]+/) : [];
  const keys = [...new Set(raw.map((k) => normalizeCarKey(String(k))).filter(Boolean))];
  const problems: ModelProblem[] = [];
  if (keys.length === 0 || keys.length > MODEL_LIMITS.carKeys) problems.push({ code: 'carKeys' });
  for (const key of keys) if (!CAR_KEY.test(key)) problems.push({ code: 'carKey', key });
  return { keys, problems };
}

export function parseNormalization(value: unknown): Normalization | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const up = v.up as Axis;
  const forward = v.forward as Axis;
  if (!AXES.includes(up) || !AXES.includes(forward) || !validAxes(up, forward)) return null;
  if (!finite(v.scale, 1e-6, 1e6) || !finite(v.yaw, -360, 360)) return null;
  const offset = v.offset;
  if (!Array.isArray(offset) || offset.length !== 3 || !offset.every((o) => finite(o, -50, 50))) return null;
  return { up, forward, scale: v.scale as number, yaw: v.yaw as number, offset: offset as Vec3 };
}

export function parseWheelAnchors(value: unknown): WheelAnchors | null {
  if (!value || typeof value !== 'object') return null;
  const out: Partial<WheelAnchors> = {};
  for (const corner of CORNERS) {
    const a = (value as Record<string, unknown>)[corner] as Record<string, unknown> | undefined;
    if (!a || !finite(a.x, -10, 10) || !finite(a.y, -5, 5) || !finite(a.z, 0, 3)) return null;
    out[corner] = { x: a.x as number, y: a.y as number, z: a.z as number, verified: a.verified === true };
  }
  const w = out as WheelAnchors;
  // LF/RF ahead of LR/RR, and each car's left (+Y) left of its right: catches a model facing backwards or mirrored
  if (!(w.LF.x > w.LR.x && w.RF.x > w.RR.x && w.LF.y > w.RF.y && w.LR.y > w.RR.y)) return null;
  return w;
}

// Where the wheels probably are, from the normalized model's size and Car Data's wheelbase when it has one: an estimate
// for the Admin to correct in the preview, never verified
export function estimateWheelAnchors(canonical: Bounds, wheelbaseMeters: number | null): WheelAnchors {
  const length = canonical.max[0] - canonical.min[0];
  const width = canonical.max[1] - canonical.min[1];
  const mid = (canonical.max[0] + canonical.min[0]) / 2;
  const base = wheelbaseMeters && wheelbaseMeters > 1 && wheelbaseMeters < length ? wheelbaseMeters : length * 0.57;
  const half = Math.max(0.4, width / 2 - 0.22);
  const radius = 0.34;
  const at = (x: number, y: number): WheelAnchor => ({ x: round(x), y: round(y), z: radius, verified: false });
  return { LF: at(mid + base / 2, half), RF: at(mid + base / 2, -half), LR: at(mid - base / 2, half), RR: at(mid - base / 2, -half) };
}
const round = (v: number) => Math.round(v * 1000) / 1000;

// The track and wheelbase the anchors make (meters), shown beside Car Data's figures
export function anchorGeometry(w: WheelAnchors) {
  return {
    wheelbase: ((w.LF.x + w.RF.x) / 2) - ((w.LR.x + w.RR.x) / 2),
    frontTrack: w.LF.y - w.RF.y,
    rearTrack: w.LR.y - w.RR.y,
  };
}

// An Admin's settings for a version (any of them), checked whole
export type ModelSettings = {
  carKeys?: string[];
  source?: string;
  license?: string;
  attribution?: string;
  notes?: string;
  normalization?: Normalization;
  wheelAnchors?: WheelAnchors;
  defaultView?: CameraView;
};

export function parseModelSettings(input: unknown): { ok: true; settings: ModelSettings } | { ok: false; problems: ModelProblem[] } {
  const v = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const problems: ModelProblem[] = [];
  const settings: ModelSettings = {};
  if (v.carKeys !== undefined) {
    const parsed = parseCarKeys(v.carKeys);
    problems.push(...parsed.problems);
    settings.carKeys = parsed.keys;
  }
  for (const field of ['source', 'license', 'attribution', 'notes'] as const) {
    if (v[field] === undefined) continue;
    const value = text(v[field]);
    if (value.length > MODEL_LIMITS[field]) problems.push({ code: 'tooLong', field });
    settings[field] = value;
  }
  if (v.normalization !== undefined) {
    const n = parseNormalization(v.normalization);
    if (!n) problems.push({ code: 'normalization' });
    else settings.normalization = n;
  }
  if (v.wheelAnchors !== undefined) {
    const w = parseWheelAnchors(v.wheelAnchors);
    if (!w) problems.push({ code: 'wheelAnchors' });
    else settings.wheelAnchors = w;
  }
  if (v.defaultView !== undefined) {
    if (!isCameraView(v.defaultView)) problems.push({ code: 'defaultView' });
    else settings.defaultView = v.defaultView;
  }
  return problems.length ? { ok: false, problems } : { ok: true, settings };
}

// What a page is told about a car's model: enough to load and place it, and to credit its author
export type ResolvedCarModel = {
  id: number;
  version: number;
  carId: number;
  carName: string;
  status: ModelStatus;
  active: boolean;
  url: string;
  bytes: number;
  normalization: Normalization;
  rawBounds: Bounds;
  wheelAnchors: WheelAnchors;
  defaultView: CameraView;
  attribution: string;
  license: string;
};

// The file's address, versioned by its contents so a browser may keep it for good: a replaced model is a new version
// with a new id and hash, never new bytes under an old address
export const modelFileUrl = (id: number, sha256: string) => `/api/car-models/${id}/file?v=${sha256.slice(0, 16)}`;
// Lap Compare's lighter copy of the same file (carModelLite.ts)
export const liteModelUrl = (url: string) => `${url}${url.includes('?') ? '&' : '?'}lite=1`;

export { DEFAULT_NORMALIZATION };
