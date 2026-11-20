// The iRacing Setups library's rules (docs/setups.md's iRacing setup collection): what an Admin's collector may send,
// where each file is stored, and how an import decides what's new. Pure, no imports, so Node runs it directly
// (scripts/car-setup-library.test.mjs).
//
// The collector (SetupLibraryScanner.cs) reads iRacing's setups folder (Documents\iRacing\setups\<car path>\...) and
// sends each setup's .sto and, when there is one, the .htm iRacing exported beside it (same name, case aside). A setup
// is identified by its simulator, car folder and path inside it without the extension ("baseline", "Season 4/race"),
// so re-saving it in iRacing updates the same setup and a different setup is never overwritten.

export const CAR_SETUP_SIMULATORS = ['iracing'] as const;
export type CarSetupSimulator = (typeof CAR_SETUP_SIMULATORS)[number];

// Objects in the private telemetry bucket, outside telemetry/ (so the weekly lap reconciliation never lists them):
// iracing-setups/<car folder>/<sha256>.sto|.htm. Content-addressed, so an object never changes, the same bytes are
// stored once however many times they're imported, and a changed file is a new object (the old one is queued for
// deletion when no setup references it any more)
export const CAR_SETUP_PREFIX = 'iracing-setups/';

export const CAR_SETUP_LIMITS = {
  // Setups one import may list (one car folder holds tens; the whole setups folder hundreds)
  setupsPerImport: 1000,
  stoBytes: 512 * 1024,
  htmBytes: 512 * 1024,
  // Path parts below the car folder (iRacing allows subfolders)
  pathDepth: 4,
  pathChars: 200,
  errorChars: 300,
  errorsPerImport: 200,
} as const;

export type CarSetupFileKind = 'sto' | 'htm';

const SHA256 = /^[0-9a-f]{64}$/;
export const isSha256 = (value: unknown): value is string => typeof value === 'string' && SHA256.test(value);

// A folder or file name part: letters, digits, space, dot, dash, underscore and a few more iRacing allows in names,
// never a path separator, "." or "..", control characters or a reserved Windows character
const PART = /^[^\\/:*?"<>|\u0000-\u001f]{1,100}$/;
const cleanPart = (part: string) => {
  const p = part.trim();
  return PART.test(p) && p !== '.' && p !== '..' && !p.endsWith('.') ? p : null;
};

// iRacing's car path as its setups folder is named (e.g. ferrari296gt3), or null
export function cleanCarFolder(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const folder = cleanPart(name);
  return folder && /^[A-Za-z0-9][A-Za-z0-9 _.-]*$/.test(folder) && folder.length <= 80 ? folder : null;
}

// The setup's path below its car folder without the extension, with forward slashes ("Season 4/race"), or null
export function cleanSetupPath(path: unknown): string | null {
  if (typeof path !== 'string' || !path.trim() || path.length > CAR_SETUP_LIMITS.pathChars) return null;
  const parts = path.replace(/\\/g, '/').split('/').map(cleanPart);
  if (!parts.length || parts.length > CAR_SETUP_LIMITS.pathDepth || parts.some((p) => p === null)) return null;
  return (parts as string[]).join('/');
}

// A file name as stored and offered for download: a base name with the expected extension
export function cleanSetupFileName(name: unknown, kind: CarSetupFileKind): string | null {
  if (typeof name !== 'string') return null;
  const base = cleanPart(name);
  if (!base || base.length > 200) return null;
  return (kind === 'sto' ? /\.sto$/i : /\.html?$/i).test(base) ? base : null;
}

// The stem a file name and setup path share, case aside: baseline.sto and Baseline.htm are one setup
export const setupStem = (fileName: string) => fileName.replace(/\.(sto|html?)$/i, '');
export const sameSetup = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

// The object's key: the car folder made safe for a key (lowercase letters, digits and dashes), the content hash and
// the file's kind. Never the file name, which stays in the database
export function carSetupObjectKey(carFolder: string, sha256: string, kind: CarSetupFileKind): string {
  if (!isSha256(sha256)) throw new Error('Bad setup file hash');
  const folder = carFolder.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'car';
  return `${CAR_SETUP_PREFIX}${folder}/${sha256}.${kind}`;
}

export const isCarSetupObjectKey = (key: string) => /^iracing-setups\/[a-z0-9-]+\/[0-9a-f]{64}\.(sto|htm)$/.test(key);

// What an import does with a setup it's told about: new (no setup at that path), unchanged (both files' hashes are the
// same, including both having no .htm), or changed (either differs, or an .htm appeared or went)
export type ImportDecision = 'new' | 'changed' | 'unchanged';

export function importDecision(
  existing: { stoSha256: string; htmSha256: string | null } | null,
  incoming: { stoSha256: string; htmSha256: string | null }
): ImportDecision {
  if (!existing) return 'new';
  return existing.stoSha256 === incoming.stoSha256 && (existing.htmSha256 ?? null) === (incoming.htmSha256 ?? null) ? 'unchanged' : 'changed';
}

// Where a setup came from. Nothing in a .sto or .htm says who made it, so imports are 'unknown' until an Admin
// records it: 'official' only once someone has checked it's one of iRacing's own setups
export const CAR_SETUP_PROVENANCES = ['official', 'user', 'unknown'] as const;
export type CarSetupProvenance = (typeof CAR_SETUP_PROVENANCES)[number];
export const isProvenance = (value: unknown): value is CarSetupProvenance =>
  typeof value === 'string' && (CAR_SETUP_PROVENANCES as readonly string[]).includes(value);

// Text that's safe to show as a file's contents: no NUL bytes in the first 8 KB (an .htm is text; anything binary sent
// as one is refused)
export function looksLikeText(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 8192);
  for (let i = 0; i < n; i++) if (bytes[i] === 0) return false;
  return true;
}
