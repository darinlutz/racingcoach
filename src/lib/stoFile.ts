// iRacing's setup files (.sto), read as far as they can be without iRacing's keys. Pure, no imports
// (scripts/setups.test.mjs). See docs/setups.md's The .sto format.
//
// Worked out from iRacing's own files (a BMW M4 GT3 EVO "fixed.sto", 18,238 bytes) and nothing else; every field is
// checked against the others before it's trusted, and a file that doesn't fit is "unsupported", never guessed at:
//   0   u32  container version (3)
//   4   u32  bytes from offset 8 to the end of the notes (= 8 + payload + 32 + notes)
//   8   u32  payload bytes (a multiple of 16)
//   12  u32  notes bytes
//   16  payload: the setup's values, encrypted (no structure, ~7.9 bits of entropy per byte, 16-byte blocks)
//   ..  32 bytes, not a plain SHA-256/SHA3/BLAKE2 of any part of the file: a keyed signature or part of the encryption
//   ..  notes: the car's setup notes, UTF-16LE, null terminated, CRLF lines
//   ..  records of (u32 1, u32 16, 16 bytes), then 8 zero bytes: identifiers whose meaning isn't known
// So the values themselves can't be read, and a changed file can't be written that iRacing would accept: the payload
// is encrypted and the file is signed. RacingCoach never tries to get round that. The values of a .sto become known
// when iRacing loads it: the collector captures the CarSetup that iRacing shows (setupYaml.ts) under the same name.

export const STO_PARSER_VERSION = 1;
export const MAX_STO_BYTES = 512 * 1024;

export type StoParseStatus = 'partial' | 'unsupported' | 'failed';

export type StoInfo = {
  parserVersion: number;
  // partial: the container was understood, the values are encrypted. unsupported: not a layout seen before.
  // failed: not a setup file (too short, or nothing adds up)
  status: StoParseStatus;
  containerVersion: number | null;
  fileBytes: number;
  payloadBytes: number | null;
  signatureHex: string | null;
  // The car's setup notes, as iRacing writes them into its own setups (empty when there are none)
  notes: string | null;
  identifiers: string[];
  // Why it's unsupported or failed, for the page and the logs (English, as they're diagnostics)
  problem: string | null;
};

const SUPPORTED_VERSIONS = [3];
const SIGNATURE_BYTES = 32;

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

export function readStoFile(input: Uint8Array): StoInfo {
  const base: StoInfo = {
    parserVersion: STO_PARSER_VERSION,
    status: 'failed',
    containerVersion: null,
    fileBytes: input.length,
    payloadBytes: null,
    signatureHex: null,
    notes: null,
    identifiers: [],
    problem: null,
  };
  if (input.length < 16 + SIGNATURE_BYTES) return { ...base, problem: 'too short to be a setup file' };
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const version = view.getUint32(0, true);
  const length = view.getUint32(4, true);
  const payload = view.getUint32(8, true);
  const notes = view.getUint32(12, true);
  const notesStart = 16 + payload + SIGNATURE_BYTES;
  const notesEnd = notesStart + notes;
  const consistent = length === 8 + payload + SIGNATURE_BYTES + notes && notesEnd <= input.length && payload % 16 === 0 && notes % 2 === 0;
  if (!consistent) {
    return {
      ...base,
      status: SUPPORTED_VERSIONS.includes(version) ? 'failed' : 'unsupported',
      containerVersion: version,
      problem: SUPPORTED_VERSIONS.includes(version) ? 'the section lengths do not add up' : `container version ${version} is not one seen before`,
    };
  }
  const info: StoInfo = {
    ...base,
    containerVersion: version,
    payloadBytes: payload,
    signatureHex: hex(input.subarray(16 + payload, notesStart)),
  };
  if (!SUPPORTED_VERSIONS.includes(version)) {
    return { ...info, status: 'unsupported', problem: `container version ${version} is not one seen before` };
  }
  let text = new TextDecoder('utf-16le').decode(input.subarray(notesStart, notesEnd));
  const nul = text.indexOf('\u0000');
  if (nul >= 0) text = text.slice(0, nul);
  info.notes = text.replace(/\r\n?/g, '\n').trim();

  // The trailer's records; a trailer that doesn't fit is left out rather than misread
  const identifiers: string[] = [];
  let at = notesEnd;
  while (at + 8 <= input.length) {
    const kind = view.getUint32(at, true);
    const size = view.getUint32(at + 4, true);
    if (kind === 0 && size === 0) break;
    if (kind !== 1 || size !== 16 || at + 8 + size > input.length || identifiers.length >= 16) {
      return { ...info, status: 'partial', identifiers, problem: 'the identifiers after the notes are not in the expected form' };
    }
    identifiers.push(hex(input.subarray(at + 8, at + 8 + size)));
    at += 8 + size;
  }
  return { ...info, status: 'partial', identifiers };
}

// A file name a setup can be saved under: no folders, at most 120 characters, ending .sto
export function cleanStoFileName(name: string): string | null {
  const base = name.split(/[\\/]/).pop()?.trim() ?? '';
  if (!/\.sto$/i.test(base) || base.length > 120 || base.length < 5) return null;
  if (/[\u0000-\u001f<>:"|?*]/.test(base)) return null;
  return base;
}
