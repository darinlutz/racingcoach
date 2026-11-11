// The Race Announcers' fixed wording: routine moments (battle gap updates, lap times, pit road, flags, cars off the
// track, passes down the field) are said from the dictionaries' broadcastPhrases rather than written by the AI, so
// they cost no AI call and play without waiting for one. The Commentary Director decides which moments these are
// (commentaryRoute, planCommentary in src/lib/broadcastDirector.ts). Every moment has several wordings in each
// language; a broadcast keeps a PhraseMemory of the wordings and openings it used lately and picks among the others,
// so the same sentence doesn't come round again soon. A wording with a {placeholder} the moment has no value for is
// skipped. No runtime imports, so Node's tests run it directly (npm run test:broadcast).

import type { Classified, Format, Speaker } from './broadcastDirector';
import type { Dictionary } from './i18n/dictionaries/en';

export type PhraseBook = Dictionary['broadcastPhrases'];
type LeadKey = keyof PhraseBook['lead'];
type ColorKey = keyof PhraseBook['color'];

// The wordings each kind used lately (avoided until the others have had a turn), and the openings of the last few
// lines of any kind, so consecutive lines don't start the same way
export type PhraseMemory = { used: Record<string, string[]>; openings: string[] };
export const newPhraseMemory = (): PhraseMemory => ({ used: {}, openings: [] });
const OPENINGS_KEPT = 4;

export type PhraseFacts = {
  // The listener's driver, as the field knows them
  driver: string;
  // How another driver is announced: their name, or with Announce driver names off their car number
  name: (driver: string) => string;
  // The driver's car, as announcers call it (e.g. "Porsche"), or null
  carOf: (driver: string) => string | null;
  multiClass: boolean;
  // The language's decimal separator
  decimal: string;
};

export type PhrasedLine = { speaker: Speaker; text: string };

type Values = Record<string, string | number | null | undefined>;
const PLACEHOLDERS = /\{(\w+)\}/g;

const placeholders = (template: string) => [...template.matchAll(PLACEHOLDERS)].map((m) => m[1]);
const fill = (template: string, values: Values) => template.replace(PLACEHOLDERS, (_, key: string) => String(values[key]));
// A wording's opening: its first two words that aren't a placeholder ("{behind} has caught {ahead}" is "has caught")
const opening = (template: string) =>
  template
    .replace(PLACEHOLDERS, ' ')
    .toLowerCase()
    .replace(/[^\p{L}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .join(' ');

// One wording of a kind, filled in, or null when none has values for all its placeholders
export function pickPhrase(memory: PhraseMemory, key: string, variants: readonly string[], values: Values, random: () => number = Math.random): string | null {
  const usable = variants.filter((v) => placeholders(v).every((p) => values[p] !== null && values[p] !== undefined && values[p] !== ''));
  if (usable.length === 0) return null;
  const recent = memory.used[key] ?? [];
  const unused = usable.filter((v) => !recent.includes(v));
  const freshStart = unused.filter((v) => !memory.openings.includes(opening(v)));
  const pool = freshStart.length > 0 ? freshStart : unused.length > 0 ? unused : usable.filter((v) => v !== recent[recent.length - 1]);
  const chosen = (pool.length > 0 ? pool : usable)[Math.floor(random() * (pool.length > 0 ? pool : usable).length)] ?? usable[0];
  // remember all but one of the usable wordings, so each comes round once the others have been said
  memory.used[key] = [...recent.filter((v) => v !== chosen), chosen].slice(-Math.max(1, usable.length - 1));
  memory.openings = [...memory.openings, opening(chosen)].slice(-OPENINGS_KEPT);
  return fill(chosen, values);
}

// Seconds as the announcers' text has them, to a tenth ("0.4 s"; the voice says "four tenths", spokenTimeGaps)
const seconds = (s: number, decimal: string) => `${Math.abs(s).toFixed(1).replace('.', decimal)} s`;
// A lap time to a tenth, 1:42.3
function lapTime(s: number, decimal: string): string {
  const tenths = Math.round(s * 10);
  const minutes = Math.floor(tenths / 600);
  const rest = (tenths % 600) / 10;
  return `${minutes}:${rest.toFixed(1).padStart(4, '0').replace('.', decimal)}`;
}

// What to say about this moment in fixed wording, for the speakers of the Director's format: the moment by the first
// speaker, and for a Lead and Color format, when there's something to add, a word from the Color Announcer. Null when
// the moment has no fixed wording (the AI writes those).
export function phraseLines(
  c: Pick<Classified, 'event'>,
  format: Format,
  facts: PhraseFacts,
  book: PhraseBook,
  memory: PhraseMemory,
  random: () => number = Math.random
): PhrasedLine[] | null {
  const e = c.event;
  const { driver, name, carOf, decimal } = facts;
  const pos = (n: number | null | undefined, carClass?: string | null) =>
    n == null || n <= 0 ? null : facts.multiClass && carClass ? fill(book.classPosition, { n, carClass }) : fill(book.position, { n });
  let lead: { key: LeadKey; values: Values } | null = null;
  let color: { key: ColorKey; values: Values } | null = null;
  switch (e.type) {
    case 'battle': {
      const keys: Record<typeof e.phase, LeadKey> = {
        start: 'battleStart',
        veryClose: 'battleVeryClose',
        closing: 'battleClosing',
        pulling: 'battlePulling',
        ended: 'battleEnded',
      };
      const values = { ahead: name(e.ahead), behind: name(e.behind), pos: pos(e.position, e.carClass), gap: seconds(e.gap, decimal) };
      lead = { key: keys[e.phase], values };
      if (e.phase !== 'pulling' && e.phase !== 'ended' && e.closingPerLap !== null && e.closingPerLap >= 0.05)
        color = { key: 'battleTrend', values: { ...values, closing: seconds(e.closingPerLap, decimal) } };
      else if (e.laps >= 2) color = { key: 'battleLaps', values: { ...values, laps: e.laps } };
      break;
    }
    case 'overtake': {
      const where = pos(e.position, e.multiClass ? e.carClass : null);
      if (e.user === 'gained') lead = { key: 'userGainedPass', values: { driver, whom: name(e.passed), pos: where, car: carOf(driver) } };
      else if (e.user === 'lost') lead = { key: 'userLostPass', values: { driver, who: name(e.driver), pos: where } };
      else lead = { key: 'overtake', values: { who: name(e.driver), whom: name(e.passed), pos: where, car: carOf(e.driver) } };
      break;
    }
    case 'positionGained':
      lead = e.passed
        ? { key: 'userGainedPass', values: { driver, whom: name(e.passed), pos: pos(e.to), car: carOf(driver) } }
        : { key: 'userGained', values: { driver, pos: pos(e.to) } };
      break;
    case 'positionLost':
      lead = e.passedBy ? { key: 'userLostPass', values: { driver, who: name(e.passedBy), pos: pos(e.to) } } : { key: 'userLost', values: { driver, pos: pos(e.to) } };
      break;
    case 'lapComplete': {
      const delta = e.bestLapTime !== null && e.lapTime > e.bestLapTime ? seconds(e.lapTime - e.bestLapTime, decimal) : null;
      lead = e.newBest
        ? { key: 'personalBest', values: { driver, lapTime: lapTime(e.lapTime, decimal) } }
        : { key: 'lapTime', values: { driver, lapTime: lapTime(e.lapTime, decimal), delta } };
      break;
    }
    case 'sessionFastestLap':
      lead = { key: 'fastestLap', values: { who: e.isDriver ? driver : name(e.driver), lapTime: lapTime(e.lapTime, decimal) } };
      break;
    case 'pitEntry':
      lead = { key: 'pitEntry', values: { driver } };
      break;
    case 'pitExit':
      lead = { key: 'pitExit', values: { driver } };
      break;
    case 'pitStop':
      lead =
        e.phase === 'in'
          ? { key: 'pitIn', values: { who: name(e.driver), pos: pos(e.position) } }
          : e.seconds !== null
            ? { key: 'pitOut', values: { who: name(e.driver), seconds: seconds(e.seconds, decimal) } }
            : { key: 'pitExit', values: { driver: name(e.driver) } };
      break;
    case 'offTrack':
      lead = { key: 'offTrack', values: { driver } };
      break;
    case 'incident':
      lead = { key: 'incident', values: { driver, total: e.total } };
      break;
    case 'flag':
      if (e.flag === 'yellow' || e.flag === 'caution' || e.flag === 'debris') lead = { key: 'yellow', values: {} };
      else if (e.flag === 'blue') lead = { key: 'blue', values: { driver } };
      else if (e.flag === 'black' || e.flag === 'repair') lead = { key: 'black', values: { driver } };
      break;
    case 'fieldIncident':
      lead = { key: e.kind === 'offTrack' ? 'carOff' : 'carSlowed', values: { who: name(e.driver) } };
      break;
    case 'nearbyIncident':
      lead = { key: e.kind === 'offTrack' ? 'nearbyOff' : 'nearbySlowed', values: { who: name(e.driver), driver } };
      break;
    default:
      return null;
  }
  if (!lead) return null;
  const first: Speaker = format === 'color' ? 'color' : 'lead';
  const text = pickPhrase(memory, lead.key, book.lead[lead.key], lead.values, random);
  if (!text) return null;
  const lines: PhrasedLine[] = [{ speaker: first, text }];
  if (first === 'lead' && format !== 'lead' && color) {
    const more = pickPhrase(memory, `color:${color.key}`, book.color[color.key], color.values, random);
    if (more) lines.push({ speaker: 'color', text: more });
  }
  return lines;
}
