// The AI coaches never say where on the track something happens (a distance from the start/finish line, or a
// share of the lap): only changes ("brake 20 ft later"), distances from a reference point they name ("10 m after
// your fastest lap's brakepoint") and spreads ("within 3 m of each other"). The tools give them only relative
// distances, the prompts say so (brakeChangeRule in debriefCoach.ts), and every answer is checked here: the coach
// gets one chance to rewrite it, then any sentence that still gives a place on the track is dropped.
// No imports, so `node --test` runs it directly (scripts/track-positions.test.mjs).

// A number of feet or meters, in English, Portuguese and Spanish
const DISTANCE_RE = /\d[\d,.]*\s*(?:ft|feet|foot|pés|pé|pies|pie|m|meters?|metres?|metros?)(?!\p{L})/giu;

// What makes a distance a change or relative: its direction or a reference after it ("30 ft later", "16 m too
// early", "10 ft after your fastest lap's brakepoint", "2 ft to the left", "50 ft into the area")
const CHANGE_AFTER_RE =
  /^[^\p{L}\p{N}]*(?:\p{L}+[^\p{L}\p{N}]+){0,2}?(?:later|earlier|sooner|late|early|deeper|apart|scatter|spread|variation|variance|swing|range|window|after|before|past|beyond|short|ahead|behind|into|longer|shorter|more|less|mais tarde|más tarde|mais cedo|más temprano|tarde|cedo|temprano|antes|depois|después|detrás|além|más allá|toward|towards|further|farther|wider|tighter|wide|para|hacia|em direção|en dirección|left|right|esquerda|direita|izquierda|derecha)(?!\p{L})/iu;
// ... or a word before it ("later by 30 ft", "within 3 m of each other", "std dev 22 ft", "varies by 30 ft")
const CHANGE_BEFORE_RE =
  /(?<!\p{L})(?:by|por|em|en|within|under|over|less than|more than|up to|dentro de|menos de|más de|mais de|até|hasta|std dev|standard deviation(?: of)?|deviation(?: of)?|desvio(?: padrão)?(?: de)?|desviación(?: estándar)?(?: de)?|spread(?: of)?|range of|varies by|varied by|differ by|differs by|gap of|diferença de|diferencia de|±|\+\/-)\s*(?:about\s+|around\s+|roughly\s+|only\s+|just\s+|cerca de\s+|unos\s+|uns\s+|apenas\s+|solo\s+|sólo\s+)?$/iu;

// A distance measured from the start/finish line is a place on the track whatever words surround it
const FROM_LINE_RE =
  /(?<!\p{L})(?:start\/finish|start-finish|start finish|s\/f|lap start|start of the lap|largada|linha de chegada|início da volta|línea de meta|línea de salida|inicio de la vuelta|salida\/meta)(?!\p{L})/iu;

// No brakepoint or throttle change is this big, and no spread either: a distance this far is a place on the track
const MAX_RELATIVE_FEET = 1000;
const MAX_RELATIVE_METERS = 300;

// A share of the lap ("at 45% of the lap", "a 45% da volta") is a place on the track too
const LAP_SHARE_RE = /\d[\d,.]*\s*%\s*(?:of|into|around|through|da|de|del|de la)\s+(?:the\s+|a\s+|la\s+)?(?:lap|volta|vuelta|track|pista)(?!\p{L})/iu;

// "1,235" or "1.235" (thousands) -> 1235, "2.5" or "2,5" (decimals) -> 2.5
function parseNumber(text: string): number {
  const digits = text.replace(/[^\d,.]/g, '').replace(/[.,]$/, '');
  if (/^\d{1,3}(?:[.,]\d{3})+$/.test(digits)) return Number(digits.replace(/[.,]/g, ''));
  return Number(digits.replace(',', '.'));
}

const isMeters = (match: string) => /(?:\d|\s)(?:m|meters?|metres?|metros?)$/iu.test(match);

export function hasTrackPosition(text: string): boolean {
  if (LAP_SHARE_RE.test(text)) return true;
  return [...text.matchAll(DISTANCE_RE)].some((m) => {
    const value = parseNumber(m[0]);
    if (value > (isMeters(m[0]) ? MAX_RELATIVE_METERS : MAX_RELATIVE_FEET)) return true;
    const before = text.slice(Math.max(0, m.index - 30), m.index);
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 40);
    if (FROM_LINE_RE.test(after)) return true;
    return !CHANGE_AFTER_RE.test(after) && !CHANGE_BEFORE_RE.test(before);
  });
}

// "First. Second!" -> ["First.", "Second!"]
function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).filter((s) => s.trim());
}

// The sentences of an answer that give a place on the track, for the coach to rewrite
export function trackPositionSentences(text: string): string[] {
  return sentences(text).filter(hasTrackPosition);
}

// An answer without the sentences that give a place on the track; paragraphs are kept
export function removeTrackPositions(text: string): string {
  return text
    .split(/\n/)
    .map((paragraph) => sentences(paragraph).filter((s) => !hasTrackPosition(s)).join(' '))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// For coaches whose data has no distances (e.g. the Stint Analysis): brakeChangeRule (debriefCoach.ts) would only
// invite them to make up braking advice
export const TRACK_POSITION_RULE =
  ' Never say where on the track something happens as a distance from the start/finish line or a share of the lap.';

// What the coach is told when its answer gives a place on the track
export function trackPositionFeedback(offending: string[]): string {
  return (
    'Your answer says where on the track something happens (a distance from the start/finish line or a share of ' +
    `the lap), which you must never do: ${offending.map((s) => `"${s.trim()}"`).join(' ')} Rewrite your whole answer ` +
    'so every distance is a change or is measured from a reference point you name, e.g. "brake 20 ft later than ' +
    'your fastest lap", "release the brake 10 m earlier" or "throttle on 30 ft after the Target Lap does", or leave ' +
    'the distance out. Keep everything else the same.'
  );
}

// An answer that says where on the track something happens gets one rewrite (with the feedback above), then
// loses the sentences that still do. Throws when nothing is left.
export async function withoutTrackPositions(answer: string, rewrite: (feedback: string) => Promise<string>): Promise<string> {
  const offending = trackPositionSentences(answer);
  const text = offending.length > 0 ? await rewrite(trackPositionFeedback(offending)) : answer;
  const clean = removeTrackPositions(text);
  if (clean !== text.trim()) console.error('AI coach answer lost sentences giving places on the track:', trackPositionSentences(text));
  if (!clean) throw new Error('The coach only said where on the track things happen');
  return clean;
}
