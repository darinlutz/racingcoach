// The checks every AI coach answer goes through before a user reads or hears it, with one rewrite for whatever is
// wrong: it never says where on the track something happens (src/lib/trackPositions.ts), and an answer for a user
// whose Preferred Language isn't English has no English words in it (src/lib/i18n/englishWords.ts). Both problems go
// back to the model in one rewrite, so a live answer (the Race Engineer, the Setup Engineer) costs at most one extra
// call. After the rewrite, sentences that still give a place on the track are dropped; English that's still there is
// logged and kept, as the rest of the answer is in the user's language.

import { query } from './db';
import { englishWords } from './i18n/englishWords';
import { aiLanguageFeedback, type Language } from './i18n/languages';
import { removeTrackPositions, trackPositionFeedback, trackPositionSentences } from './trackPositions';
import { ensureUserSchema } from './users';

export type LanguageCheck = {
  language: Language;
  // Names in the data the answer may use as they are: tracks, cars, focus areas, drivers, series. Every Track Data
  // track, layout and focus area and Car Data car is added to them (siteNames), as names like "Circuit of the
  // Americas" or "NASCAR Cup Series Next Gen" are made of English words
  names?: string[];
};

// Track Data's track, layout and focus area names and Car Data's car names, kept for a few minutes
const SITE_NAMES_FOR_MS = 5 * 60_000;
let siteNamesCache: { at: number; names: string[] } | null = null;

export async function siteNames(): Promise<string[]> {
  if (siteNamesCache && Date.now() - siteNamesCache.at < SITE_NAMES_FOR_MS) return siteNamesCache.names;
  try {
    await ensureUserSchema();
    const rows = await query(
      `SELECT track_name AS name FROM racingcoach."Tracks"
       UNION SELECT config_name FROM racingcoach."Tracks" WHERE config_name IS NOT NULL
       UNION SELECT name FROM racingcoach."TrackFocusAreas"
       UNION SELECT car_name FROM racingcoach."Cars"`
    );
    const names = rows.map((r) => String(r.name ?? '')).filter(Boolean);
    siteNamesCache = { at: Date.now(), names };
    return names;
  } catch (error) {
    // the check still runs with the names the caller gave
    console.warn('Could not load the site’s track and car names for the language check:', error instanceof Error ? error.message : error);
    return siteNamesCache?.names ?? [];
  }
}

// The language check for a user's language, with the caller's names and the site's; undefined for English, which
// needs none
export async function languageCheck(language: Language, names: string[] = []): Promise<LanguageCheck | undefined> {
  if (language === 'en') return undefined;
  return { language, names: [...names, ...(await siteNames())] };
}

// What's wrong with an answer, as the feedback for its rewrite; empty when nothing is
export function answerFeedback(answer: string, check?: LanguageCheck): string {
  const offending = trackPositionSentences(answer);
  const english = check ? englishWords(answer, check.language, check.names) : [];
  return [offending.length > 0 ? trackPositionFeedback(offending) : '', check ? aiLanguageFeedback(check.language, english) : '']
    .filter(Boolean)
    .join(' ');
}

// An answer that says where on the track something happens, or has English words for a user of another language, gets
// one rewrite (with the feedback above), then loses the sentences that still give a place on the track. Throws when
// nothing is left.
export async function checkedAnswer(
  answer: string,
  rewrite: (feedback: string) => Promise<string>,
  check?: LanguageCheck
): Promise<string> {
  const feedback = answerFeedback(answer, check);
  const text = feedback ? await rewrite(feedback) : answer;
  const clean = removeTrackPositions(text);
  if (clean !== text.trim()) console.error('AI coach answer lost sentences giving places on the track:', trackPositionSentences(text));
  if (!clean) throw new Error('The coach only said where on the track things happen');
  const english = check ? englishWords(clean, check.language, check.names) : [];
  if (english.length > 0) console.warn(`AI answer still has English words for a ${check!.language} user: ${english.join(', ')}`);
  return clean;
}

// Any name-like strings in data sent to an AI (tracks, cars, drivers, series, focus areas), for LanguageCheck.names:
// the string values of keys such as name, car, track, series, driver or area, at any depth
export function namesIn(value: unknown, depth = 0): string[] {
  if (depth > 6 || value === null || typeof value !== 'object') return [];
  const out: string[] = [];
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === 'string' && /(name|car|track|series|session|driver|area|class|layout|config)s?$/i.test(key)) out.push(item);
    else if (Array.isArray(item) && item.every((v) => typeof v === 'string') && /(names|cars|tracks|drivers|areas)$/i.test(key)) out.push(...item);
    else out.push(...namesIn(item, depth + 1));
  }
  return out;
}
