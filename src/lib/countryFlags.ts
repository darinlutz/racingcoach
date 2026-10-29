// Live Racing's leaderboard shows a small flag of each driver's country: the flair they picked in iRacing (session
// info's DriverInfo.Drivers[].FlairName, e.g. "Brazil", "United States of America", "Scotland"), sent by the
// collector from 1.54.0. Turned here into the flag-icons code the page draws (`fi fi-<code>`): an ISO 3166-1 alpha-2
// code in lowercase, or one of flag-icons' subdivisions (gb-eng, gb-sct, gb-wls, gb-nir, es-ct, es-pv, es-ga) or eu.
// null for "No Flair" and names that aren't a country we know.

// Names iRacing may use that aren't the English short names Intl gives (normalized, see normalize)
const ALIASES: Record<string, string> = {
  'united states of america': 'us',
  usa: 'us',
  'great britain': 'gb',
  britain: 'gb',
  uk: 'gb',
  'united kingdom of great britain and northern ireland': 'gb',
  england: 'gb-eng',
  scotland: 'gb-sct',
  wales: 'gb-wls',
  'northern ireland': 'gb-nir',
  catalonia: 'es-ct',
  catalunya: 'es-ct',
  'basque country': 'es-pv',
  galicia: 'es-ga',
  'european union': 'eu',
  europe: 'eu',
  'russian federation': 'ru',
  'korea republic of': 'kr',
  'republic of korea': 'kr',
  korea: 'kr',
  'korea democratic peoples republic of': 'kp',
  'north korea': 'kp',
  'czech republic': 'cz',
  turkey: 'tr',
  'viet nam': 'vn',
  'iran islamic republic of': 'ir',
  'taiwan province of china': 'tw',
  'chinese taipei': 'tw',
  'hong kong': 'hk',
  macao: 'mo',
  macau: 'mo',
  'bolivia plurinational state of': 'bo',
  'venezuela bolivarian republic of': 've',
  'moldova republic of': 'md',
  'tanzania united republic of': 'tz',
  'holy see': 'va',
  'vatican city': 'va',
  'the netherlands': 'nl',
  holland: 'nl',
  'brunei darussalam': 'bn',
  'ivory coast': 'ci',
  'cote divoire': 'ci',
  'lao peoples democratic republic': 'la',
  'syrian arab republic': 'sy',
  'palestine state of': 'ps',
  'micronesia federated states of': 'fm',
  'congo the democratic republic of the': 'cd',
  'democratic republic of the congo': 'cd',
  'republic of the congo': 'cg',
  macedonia: 'mk',
  'macedonia the former yugoslav republic of': 'mk',
  swaziland: 'sz',
  'cape verde': 'cv',
  burma: 'mm',
  'virgin islands british': 'vg',
  'virgin islands us': 'vi',
  'saint martin french part': 'mf',
  'sint maarten dutch part': 'sx',
  'falkland islands malvinas': 'fk',
};

// Lowercase, without accents, punctuation or extra spaces: "Côte d’Ivoire" is "cote divoire"
function normalize(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

let byName: Map<string, string> | null = null;

// Every region's English name (Intl's, e.g. "Czechia", "Hong Kong SAR China") by its normalized name, plus ALIASES
function names(): Map<string, string> {
  if (byName) return byName;
  byName = new Map();
  try {
    const display = new Intl.DisplayNames(['en'], { type: 'region' });
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    for (const a of letters) {
      for (const b of letters) {
        const code = a + b;
        let name: string | undefined;
        try {
          name = display.of(code);
        } catch {
          continue;
        }
        if (name && name !== code) byName.set(normalize(name), code.toLowerCase());
      }
    }
  } catch {
    // no Intl region names: aliases only
  }
  for (const [name, code] of Object.entries(ALIASES)) byName.set(name, code);
  return byName;
}

// The flag-icons code of an iRacing flair, or null
export function flagCodeForFlair(flair: string | null | undefined): string | null {
  if (!flair) return null;
  const key = normalize(flair);
  if (!key || key === 'no flair' || key === 'none') return null;
  return names().get(key) ?? null;
}
