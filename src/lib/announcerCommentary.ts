import { getCoachVoice, synthesizeSpeech, type SpeechFormat } from './coachVoice';
import { readRaceEvents } from './liveRacing';
import { ANNOUNCER_ROLES, getRaceAnnouncerSettings, raceAnnouncerLines, type Announcer } from './raceAnnouncer';
import { aiRateLimit, type AiRateLimit } from './rateLimits';
import type { User } from './users';

// One Race Announcer commentary (src/lib/raceAnnouncer.ts) for a live driver the user may watch, shared by the Live
// Racing page (POST /api/live/announcer, WAV) and TV Broadcast Mode (POST /api/tv/announcer, MP3): the driver's race
// events newer than after, commentated by the RaceAnnouncer agent in the user's Preferred Language and spoken by the
// announcers turned on. No AI call when nothing new happened.

// Events older than this aren't announced any more: the moment has passed
const FRESH_MS = 30_000;
// What each user's announcers said lately, so they don't say it again (this server's memory only)
const RECENT_LINES = 6;
const recentLines = new Map<number, string[]>();

export type SpokenLine = { speaker: Announcer; text: string; audio: string };

export type CommentaryResult =
  | { kind: 'notLive' }
  // seq: the newest event's number, to send as after next time; audio is base64
  | { kind: 'lines'; seq: number; lines: SpokenLine[] }
  | { kind: 'refused'; response: Response };

export async function commentate(input: {
  request: Request;
  user: User;
  driverId: number;
  after: number;
  lead: boolean;
  color: boolean;
  format: SpeechFormat;
}): Promise<CommentaryResult> {
  const { user, driverId, after, format } = input;
  const found = await readRaceEvents(user, driverId, after);
  if (!found) return { kind: 'notLive' };
  const events = found.events.filter((e) => Date.now() - e.at <= FRESH_MS);
  const speakers: Announcer[] = [...(input.lead ? ['lead' as const] : []), ...(input.color ? ['color' as const] : [])];
  if (events.length === 0 || speakers.length === 0) return { kind: 'lines', seq: found.seq, lines: [] };

  let limit: AiRateLimit | null = null;
  try {
    limit = await aiRateLimit(input.request, 'raceAnnouncer', user);
    if (limit.response) return { kind: 'refused', response: limit.response };
    const [settings, { spanishAccent }] = await Promise.all([getRaceAnnouncerSettings(user.id), getCoachVoice(user.id)]);
    const lines = await limit.track(() =>
      raceAnnouncerLines({
        events,
        context: found.context,
        speakers,
        instructions: settings.instructions,
        recentLines: recentLines.get(user.id) ?? [],
        language: user.preferredLanguage,
      })
    );
    recentLines.set(user.id, [...(recentLines.get(user.id) ?? []), ...lines.map((l) => l.text)].slice(-RECENT_LINES));

    const spoken = await Promise.all(
      lines.map(async (line) => {
        const voice = line.speaker === 'lead' ? settings.leadVoice : settings.colorVoice;
        const audio = await synthesizeSpeech(line.text, voice, user.preferredLanguage, spanishAccent, ANNOUNCER_ROLES[line.speaker], format);
        return { ...line, audio: audio.toString('base64') };
      })
    );
    return { kind: 'lines', seq: found.seq, lines: spoken };
  } catch (error) {
    await limit?.refund();
    throw error;
  }
}
