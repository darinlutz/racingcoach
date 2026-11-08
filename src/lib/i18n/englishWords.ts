// Finds English words in text meant to be in Portuguese, Spanish or German, so an AI answer that slipped into English
// ("Frena 6 m más tarde que tu fastest lap", "Vuelta 3: keep the throttle") can be rewritten or left out before a
// user reads or hears it (src/lib/answerChecks.ts). Names are taken out first: tracks, cars, focus areas, drivers and
// series keep the names they have in the data, whatever language those are in.
//
// The words are common English words and the racing terms the coaches' data gives in English that are never words of
// the other language (or, listed under SHARED, are words there too, e.g. German "will" and "fast", Portuguese "for",
// "time" and "tire", Spanish "has" and "he"). Loanwords racing uses in every one of these languages (pit, box, stint,
// setup, grip, delta, sprint, safety car) aren't listed.
// No imports, so Node's tests run it directly (npm run test:language).

const WORDS = [
  // function words
  'the', 'and', 'with', 'without', 'your', 'yours', 'you', 'is', 'are', 'was', 'were', 'been', 'being', 'have', 'has',
  'had', 'of', 'to', 'for', 'from', 'than', 'then', 'that', 'this', 'these', 'those', 'there', 'here', 'what', 'when',
  'where', 'which', 'who', 'why', 'how', 'it', 'its', 'be', 'will', 'would', 'should', 'could', 'can', 'cannot', 'not',
  'but', 'or', 'if', 'just', 'very', 'much', 'too', 'also', 'only', 'still', 'again', 'already', 'now', 'next', 'last',
  'first', 'after', 'before', 'ahead', 'behind', 'inside', 'outside', 'into', 'onto', 'about', 'around', 'through',
  'over', 'under', 'between', 'until', 'while', 'more', 'less', 'most', 'least', 'better', 'worse', 'same', 'every',
  'each', 'all', 'some', 'any', 'out', 'off', 'up', 'down', 'back', 'well', 'good', 'great', 'nice', 'yes', 'we', 'they',
  'them', 'our', 'my', 'us', 'he', 'she', 'his', 'her', 'him', 'on', 'at', 'by', 'as', 'do', 'does', 'did', 'an',
  'keep', 'get', 'got', 'try', 'let', 'make', 'take', 'need', 'want', 'see', 'look', 'know', 'think', 'feel', 'give',
  'going', 'doing', 'stay', 'hold',
  // racing
  'lap', 'laps', 'brake', 'brakes', 'braking', 'brakepoint', 'brakepoints', 'throttle', 'trail', 'coast', 'coasting',
  'apex', 'apexes', 'corner', 'corners', 'cornering', 'turn', 'turns', 'straight', 'straights', 'speed', 'speeds',
  'faster', 'slower', 'fastest', 'slowest', 'quicker', 'quickest', 'later', 'earlier', 'sooner', 'early', 'smooth',
  'smoother', 'carry', 'exit', 'entry', 'release', 'pickup', 'upshift', 'downshift', 'shift', 'gear', 'gears', 'tire',
  'tires', 'tyre', 'tyres', 'wheel', 'steering', 'line', 'driver', 'drivers', 'car', 'cars', 'track', 'session', 'practice',
  'qualifying', 'race', 'races', 'flag', 'green', 'yellow', 'checkered', 'chequered', 'leader', 'gap', 'gaps', 'push',
  'pushing', 'pace', 'lost', 'gain', 'gained', 'losing', 'time', 'times', 'seconds', 'second', 'tenths', 'tenth', 'feet',
  'foot', 'meters', 'metres', 'target', 'focus', 'area', 'areas', 'consistency', 'consistent', 'understeer', 'oversteer',
  'spin', 'crash', 'overtake', 'pass', 'passed', 'passes', 'battle', 'fuel', 'tank', 'fight', 'win', 'wins', 'winner',
  'podium', 'position', 'positions', 'lift', 'pressure', 'peak', 'minimum', 'maximum', 'average', 'slow', 'fast',
  'late', 'compare', 'reference', 'theoretical', 'optimal', 'incident', 'incidents', 'rating',
];

// Words of each language that are also on the list above, so they say nothing about English
const SHARED: Record<string, string[]> = {
  pt: ['as', 'do', 'for', 'time', 'times', 'tire', 'more', 'late', 'compare'],
  es: ['as', 'he', 'has', 'tire', 'tires', 'pace', 'late', 'compare'],
  de: [
    'was', 'will', 'also', 'still', 'last', 'all', 'an', 'fast', 'pass', 'tank', 'lift', 'podium', 'position', 'hold',
    'meters', 'most', 'line', 'minimum', 'maximum', 'rating',
  ],
};

const WORD_SET = new Set(WORDS);
const SHARED_SETS: Record<string, Set<string>> = Object.fromEntries(Object.entries(SHARED).map(([k, v]) => [k, new Set(v)]));

// Always kept: the site, the simulator and the lap export the site reads
const ALWAYS_NAMES = ['RacingCoach.app', 'RacingCoach', 'iRacing', 'Garage 61', 'Assetto Corsa Competizione', 'Simucube'];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The text with the names taken out (whole words only, ignoring case), longest first so "Lime Rock Park" goes before "Lime"
function withoutNames(text: string, names: string[]): string {
  const all = [...new Set([...names, ...ALWAYS_NAMES].map((n) => n.trim()).filter((n) => n.length >= 2))].sort((a, b) => b.length - a.length);
  let out = text;
  for (const name of all) {
    // most of the site's names aren't in any one answer
    if (!out.toLowerCase().includes(name.toLowerCase())) continue;
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escape(name)}(?![\\p{L}\\p{N}])`, 'giu'), ' ');
  }
  return out;
}

// The English words in text written for language ('pt', 'es' or 'de'; none for English), each once, in the order
// they first appear. names: the names in the data the text may use as they are. Placeholders such as {lapTime} are
// left out, and so are English contractions ("don't", "you're"), which are English whatever the word.
export function englishWords(text: string, language: string, names: string[] = []): string[] {
  if (!text || language === 'en' || !(language in SHARED)) return [];
  const shared = SHARED_SETS[language];
  const found = new Set<string>();
  const plain = withoutNames(text.replace(/\{[^}]*\}/g, ' '), names);
  for (const match of plain.matchAll(/\p{L}+(?:['’]\p{L}+)?/gu)) {
    const word = match[0].toLowerCase().replace(/’/g, "'");
    const contraction = /^\p{L}+'(?:t|re|ll|ve|d|m)$/u.test(word);
    if (contraction || (WORD_SET.has(word) && !shared.has(word))) found.add(word);
  }
  return [...found];
}

export function hasEnglish(text: string, language: string, names: string[] = []): boolean {
  return englishWords(text, language, names).length > 0;
}
