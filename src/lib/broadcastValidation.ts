// Checks a Race Announcer line against the facts it was given before it's spoken (src/lib/raceAnnouncer.ts), and
// shapes its text for the intensity it's delivered at. The AI phrases the commentary; it must not add race facts, so
// a line is dropped when it names a driver in the session it wasn't told about, or writes a number in digits that
// isn't among the facts (lines are asked to write numbers as words, so a digit is either a copied fact or invented).
// Numbers written as words aren't checked. No imports, so Node's tests run it directly (npm run test:broadcast).

export type LineFacts = {
  // Drivers the line may name: those in the event, the listener's driver, and the others it was given
  allowedNames: string[];
  // Everyone in the session, so a name that's not allowed is recognised
  fieldNames: string[];
  // Numbers it may write: positions, laps, counts, minutes, car numbers, turn numbers
  allowedNumbers: number[];
  // Times and gaps it may write, as given (e.g. "1:42.318", "0.4")
  allowedDecimals: string[];
};

export type LineCheck = { ok: true } | { ok: false; reason: 'unsupportedDriver' | 'unsupportedNumber'; detail: string };

// iRacing adds a number to repeated names ("John Smith2"); the announcers say the name without it
export const baseName = (name: string) => name.trim().replace(/\d+$/, '').trim();
export const lastNameOf = (name: string) => baseName(name).split(/\s+/).pop() ?? name;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function mentions(text: string, word: string): boolean {
  if (word.length < 3) return false;
  return new RegExp(`(^|[^\\p{L}])${escape(word)}($|[^\\p{L}])`, 'u').test(text);
}

export function checkLine(text: string, facts: LineFacts): LineCheck {
  const allowedWords = new Set<string>();
  for (const name of facts.allowedNames) {
    for (const part of baseName(name).split(/\s+/)) allowedWords.add(part.toLowerCase());
  }
  for (const name of facts.fieldNames) {
    const last = lastNameOf(name);
    // a driver sharing a last name with an allowed one can't be told apart, so isn't refused
    if (allowedWords.has(last.toLowerCase())) continue;
    if (mentions(text, last) || mentions(text, baseName(name))) return { ok: false, reason: 'unsupportedDriver', detail: name };
  }
  const allowedInts = new Set(facts.allowedNumbers.map((n) => Math.round(n)));
  for (const match of text.matchAll(/\d+(?:[.:,]\d+)*/g)) {
    const token = match[0];
    if (/[.:,]/.test(token)) {
      const normal = token.replace(',', '.');
      if (!facts.allowedDecimals.some((d) => d === normal || d.startsWith(normal) || normal.startsWith(d))) {
        return { ok: false, reason: 'unsupportedNumber', detail: token };
      }
    } else if (!allowedInts.has(Number(token))) {
      return { ok: false, reason: 'unsupportedNumber', detail: token };
    }
  }
  return { ok: true };
}

// The text as the voice should read it at this intensity: no shouting in capitals (a voice spells some out), no
// stacked exclamation marks, none at all when calm, and at most two in a line otherwise
export function deliveryText(text: string, intensity: number): string {
  let out = text.replace(/\b([A-Z]{4,})\b/g, (w) => w[0] + w.slice(1).toLowerCase());
  out = out.replace(/!{2,}/g, '!').replace(/\?!|!\?/g, '?');
  if (intensity <= 2) return out.replace(/!/g, '.');
  let count = 0;
  const allowed = intensity >= 4 ? 2 : 1;
  return out.replace(/!/g, () => (++count <= allowed ? '!' : '.'));
}

// Cuts a line to about what can be said in seconds (WORDS_PER_SECOND), at a sentence end when there is one
const WORDS_PER_SECOND = 2.8;
export function fitToSeconds(text: string, seconds: number): string {
  const words = text.trim().split(/\s+/);
  const max = Math.max(4, Math.floor(seconds * WORDS_PER_SECOND));
  if (words.length <= max) return text.trim();
  const cut = words.slice(0, max).join(' ');
  if (/[.!?]$/.test(cut)) return cut;
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return end > cut.length / 3 ? cut.slice(0, end + 1) : cut.replace(/[,;:]?$/, '.');
}

export const estimatedSeconds = (text: string) => text.trim().split(/\s+/).length / WORDS_PER_SECOND;
