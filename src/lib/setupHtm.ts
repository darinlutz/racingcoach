// iRacing's garage setup export (the .htm iRacing writes beside a .sto when a setup is saved or exported), read into
// structured values for the Setups page's iRacing Setups tab (docs/setups.md's iRacing setup collection). Pure, no I/O
// and no HTML library: the file is never rendered or put in a DOM, only tokenized here, so nothing in it can run.
//
// The format, from iRacing's own exports (scripts/fixtures/setups/htm/), HTML 4 written by the sim:
//   <H2 align="center">iRacing.com Motorsport Simulations<br> ferrari296gt3 setup: &lt;baseline&gt;<br> track: spa up</H2>
//   <H2><U>LEFT FRONT:</U></H2>                     a box of the garage (a heading ending in a colon)
//   Starting pressure: <U>20.5 psi</U><br>          a value: its label, then the value underlined
//   Last temps O M I: <U>112F</U><br><U>112F</U><br><U>112F</U><br>   one value per line after the first: a list
//   Third spring defl: <U>0.292 in</U><br>of <U>3.090 in</U><br>      "of" joins the travel available to the value
//   <H2><U>Wheel lockup lights.  This car has ABS ...</U></H2>        a heading with no colon: the box's description
//   <H2><U>NOTES:</U></H2> free text lines           the setup's notes
// Boxes repeat (LEFT FRONT is the tires' box and the chassis' box), so a value is identified by its box and label in
// order, and the path gets #2, #3 for a box seen again with the same label. Labels, values and units are kept exactly
// as written; numbers are read with setupYaml.ts's readValue, and the category and whether it's a reading with its
// rules, so the same parameter lands in the same category whichever way it reached the site. Nothing is invented: a
// line that doesn't fit is a warning, never a guessed value. The keys differ from car to car; nothing assumes which.

import { categoryOf, readValue, READING_KEYS, type SetupCategory } from './setupYaml.ts';

export const SETUP_HTM_PARSER_VERSION = 1;
export const MAX_SETUP_HTM_BYTES = 512 * 1024;

export type HtmParameter = {
  // The box and label as camel case keys, e.g. LeftFront.StartingPressure (LeftFront#2.CornerWeight for a box seen
  // again with that label)
  path: string;
  // The box's heading and the label exactly as iRacing wrote them (without their colons)
  section: string;
  label: string;
  // Which box: its position among the export's boxes, from 0
  sectionIndex: number;
  key: string;
  // Exactly as written: the underlined values joined with ", ", and "of" lines as written ("0.292 in of 3.090 in")
  raw: string;
  value: number | null;
  unit: string | null;
  values: number[];
  decimals: number;
  category: SetupCategory;
  kind: 'setting' | 'reading';
  inCar: boolean;
};

export type HtmSection = { index: number; title: string; description: string[] };

export type ParsedSetupHtm = {
  parserVersion: number;
  // parsed: values were found. empty: an export with no values. failed: not iRacing's setup export
  status: 'parsed' | 'empty' | 'failed';
  encoding: 'utf-8' | 'latin-1';
  // From the export's title heading, when it has one
  carPath: string | null;
  setupName: string | null;
  track: string | null;
  sections: HtmSection[];
  parameters: HtmParameter[];
  notes: string;
  // Lines that didn't fit the format, for the page and the logs (English, as they're diagnostics)
  warnings: string[];
};

const MAX_WARNINGS = 50;

// Text as iRacing wrote it: UTF-8 when it's valid, else Latin-1 (older exports are Windows-1252/Latin-1)
export function decodeHtm(bytes: Uint8Array): { text: string; encoding: 'utf-8' | 'latin-1' } {
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('latin1').decode(bytes), encoding: 'latin-1' };
  }
}

const NAMED: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", nbsp: ' ', deg: '°', micro: 'µ', plusmn: '±' };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (match, entity: string) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return NAMED[entity.toLowerCase()] ?? match;
  });
}

const clean = (text: string) => decodeEntities(text).replace(/\s+/g, ' ').trim();

// "LEFT FRONT TIRE" is LeftFrontTire, "Toe-in" ToeIn, "Front master cyl." FrontMasterCyl, "Trac Ctrl (TCC) setting"
// TracCtrlTCCSetting
export function camelKey(text: string): string {
  return text
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((word) => (/^[A-Z0-9]+$/.test(word) && word.length > 1 && /[a-z]/.test(text) ? word : word[0].toUpperCase() + word.slice(1).toLowerCase()))
    .join('');
}

// What the export says beyond setupYaml.ts's rules: its own box names and labels
const HTM_READING_KEYS = [/Defl$/i, /^SpeedIn/i, /^LD$/i, /^AeroBalance$/i, /^DownforceBalance$/i, /^DownforceToDrag$/i];
const HTM_READING_SECTIONS = [/^AeroBalanceCalc$/i, /^AeroCalculator$/i];
const HTM_CATEGORY_RULES: [RegExp, SetupCategory][] = [
  [/TracCtrl|TractionControl|ThrottleShape/i, 'electronics'],
  [/Defl$|PushrodLength|PinLength/i, 'suspension'],
];

function classify(sectionKey: string, key: string): { category: SetupCategory; kind: 'setting' | 'reading'; inCar: boolean } {
  const rule = HTM_CATEGORY_RULES.find(([pattern]) => pattern.test(key));
  const category = rule ? rule[1] : categoryOf(sectionKey, sectionKey, key);
  const reading =
    READING_KEYS.some((p) => p.test(key)) || HTM_READING_KEYS.some((p) => p.test(key)) || HTM_READING_SECTIONS.some((p) => p.test(sectionKey));
  return { category, kind: reading ? 'reading' : 'setting', inCar: /InCar/i.test(sectionKey) };
}

type Token = { tag: string; close: boolean; attrs: string } | { text: string };

function tokenize(html: string): Token[] {
  const body = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<![^>]*>/g, ' ')
    .replace(/<(script|style|head)\b[\s\S]*?<\/\1\s*>/gi, ' ');
  const tokens: Token[] = [];
  const pattern = /<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)([^>]*)>|([^<]+)|</g;
  for (let match = pattern.exec(body); match; match = pattern.exec(body)) {
    if (match[2]) tokens.push({ tag: match[2].toLowerCase(), close: match[1] === '/', attrs: match[3] ?? '' });
    else tokens.push({ text: match[4] ?? '<' });
  }
  return tokens;
}

export function parseSetupHtm(input: Uint8Array | string): ParsedSetupHtm {
  const { text: html, encoding } = typeof input === 'string' ? { text: input, encoding: 'utf-8' as const } : decodeHtm(input);
  const result: ParsedSetupHtm = {
    parserVersion: SETUP_HTM_PARSER_VERSION,
    status: 'failed',
    encoding,
    carPath: null,
    setupName: null,
    track: null,
    sections: [],
    parameters: [],
    notes: '',
    warnings: [],
  };
  const warn = (message: string) => {
    if (result.warnings.length < MAX_WARNINGS) result.warnings.push(message);
  };
  if (!/iRacing/i.test(html.slice(0, 4096)) || !/<h2/i.test(html)) {
    warn('not an iRacing setup export (no iRacing title or headings)');
    return result;
  }

  const notes: string[] = [];
  const paths = new Set<string>();
  let section: HtmSection | null = null;
  let inNotes = false;
  let heading: { center: boolean; text: string } | null = null;
  let underline: string | null = null;
  // The line being read: its text outside the underlines, and its underlined values
  let label = '';
  let values: string[] = [];
  let last: HtmParameter | null = null;

  const addParameter = (labelText: string, raws: string[]) => {
    if (!section) {
      warn(`value outside any box: ${labelText}`);
      return null;
    }
    const sectionKey = camelKey(section.title) || `Section${section.index}`;
    const key = camelKey(labelText) || 'Value';
    let path = `${sectionKey}.${key}`;
    for (let n = 2; paths.has(path); n++) path = `${sectionKey}#${n}.${key}`;
    paths.add(path);
    const raw = raws.join(', ');
    const parameter: HtmParameter = {
      path,
      section: section.title,
      label: labelText,
      sectionIndex: section.index,
      key,
      raw,
      ...readValue(raw),
      ...classify(sectionKey, key),
    };
    result.parameters.push(parameter);
    return parameter;
  };

  const endLine = () => {
    const text = clean(label);
    const raws = values.map(clean).filter((v) => v !== '');
    label = '';
    values = [];
    if (inNotes) {
      const line = [text, ...raws].filter(Boolean).join(' ');
      notes.push(line);
      return;
    }
    if (!text && !raws.length) {
      // A blank line ends a value's continuation lines
      last = null;
      return;
    }
    if (text.endsWith(':') && text.length > 1) {
      if (!raws.length) {
        warn(`no value for ${text}`);
        last = null;
        return;
      }
      last = addParameter(text.slice(0, -1).trim(), raws);
      return;
    }
    if (!text && raws.length && last) {
      // Another value of the line before: a list such as a tire's three temperatures
      last.raw = [last.raw, ...raws].join(', ');
      Object.assign(last, readValue(last.raw));
      return;
    }
    if (text && raws.length && last && text.split(' ').length <= 2) {
      // "of 3.090 in": the travel the value is out of, kept as written
      last.raw = `${last.raw} ${text} ${raws.join(', ')}`;
      Object.assign(last, readValue(last.raw));
      return;
    }
    warn(`unrecognized line: ${[text, ...raws].join(' ').slice(0, 120)}`);
  };

  const endHeading = (h: { center: boolean; text: string }) => {
    const text = clean(h.text);
    if (!text) return;
    if (h.center && result.sections.length === 0) {
      // "iRacing.com Motorsport Simulations | ferrari296gt3 setup: <baseline> | track: spa up"
      const setup = /^(.*?)\s+setup:\s*<(.*)>/i.exec(h.text.split(/\n/).map(clean).join(' ').replace(/^iRacing\.com Motorsport Simulations\s*/i, ''));
      if (setup) {
        result.carPath = setup[1].trim() || null;
        result.setupName = setup[2].trim() || null;
      }
      const track = /track:\s*(.*)$/i.exec(text);
      if (track) result.track = track[1].trim() || null;
      return;
    }
    if (text.endsWith(':')) {
      const title = text.slice(0, -1).trim();
      inNotes = /^notes$/i.test(title);
      last = null;
      if (inNotes) return;
      section = { index: result.sections.length, title, description: [] };
      result.sections.push(section);
      return;
    }
    // A heading with no colon describes the box it's in
    if (inNotes) notes.push(text);
    else if (section) section.description.push(text);
    else warn(`heading outside any box: ${text.slice(0, 120)}`);
  };

  for (const token of tokenize(html)) {
    if ('text' in token) {
      if (heading) heading.text += token.text;
      else if (underline !== null) underline += token.text;
      else label += token.text;
      continue;
    }
    const { tag, close } = token;
    if (tag === 'h1' || tag === 'h2' || tag === 'h3') {
      if (!close) {
        if (label.trim() || values.length) endLine();
        heading = { center: /align\s*=\s*["']?center/i.test(token.attrs), text: '' };
      } else if (heading) {
        endHeading(heading);
        heading = null;
      }
    } else if (tag === 'br') {
      if (heading) heading.text += '\n';
      else {
        if (underline !== null) {
          values.push(underline);
          underline = null;
        }
        endLine();
      }
    } else if (tag === 'u' && !heading) {
      if (!close) underline = '';
      else if (underline !== null) {
        values.push(underline);
        underline = null;
      }
    } else if ((tag === 'body' || tag === 'html') && close) {
      if (underline !== null) values.push(underline);
      underline = null;
      endLine();
    }
  }
  if (label.trim() || values.length) endLine();

  result.notes = notes
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  result.status = result.parameters.length ? 'parsed' : result.sections.length || result.carPath ? 'empty' : 'failed';
  if (result.status === 'failed') warn('no setup values or boxes found');
  return result;
}

// A file name the collector sent, as a stored name: a plain base name ending in .htm or .html, no path, no control
// characters, at most 200 characters (the .sto's own check is stoFile.ts's cleanStoFileName)
export function cleanHtmFileName(name: string): string | null {
  const base = name.trim();
  if (!base || base.length > 200 || /[\\/:*?"<>|\u0000-\u001f]/.test(base) || base === '.' || base === '..') return null;
  return /\.html?$/i.test(base) ? base : null;
}
