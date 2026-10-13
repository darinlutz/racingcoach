import { NextResponse } from 'next/server';
import { z } from 'zod';
import { aiErrorResponse } from '@/lib/aiErrors';
import { carRpmLimit } from '@/lib/carData';
import { authenticateCollector } from '@/lib/collectorKeys';
import { readCollectorLapsByClientId } from '@/lib/collectorLaps';
import { measureDebriefSession } from '@/lib/debriefSession';
import { DEFAULT_LANGUAGE, LANGUAGE_LOCALES } from '@/lib/i18n/languages';
import { inCarCoachCallouts, inCarCoachPlan } from '@/lib/inCarCoach';
import { lapSamplesFromText } from '@/lib/lapData';
import { findTrackByName, readTracks, toLapTrack } from '@/lib/tracks';
import { DEFAULT_UNITS } from '@/lib/units';
import { getInCarCoachInstructions, getUserById } from '@/lib/users';

// The telemetry collector's In-Car AI Coach (src/lib/inCarCoach.ts), authenticated with the upload key as a
// bearer token, like /api/collector/laps.

// The agent makes several model calls (one per tool round)
export const maxDuration = 60;

async function userContext(request: Request) {
  const userId = await authenticateCollector(request);
  if (userId === null) return null;
  const [user, instructions] = await Promise.all([getUserById(userId), getInCarCoachInstructions(userId)]);
  return {
    userId,
    instructions,
    language: user?.preferredLanguage ?? DEFAULT_LANGUAGE,
    units: user?.units ?? DEFAULT_UNITS,
  };
}

// GET ?track=<iRacing track name>: at the start of a session, the user's In-Car AI Coach Instructions turned into
// the plan the collector runs: { instructions, plan: { rules, speak, show, holdInFocusAreas, lapFeedback,
// feedbackEveryLaps }, areas: [{ name, start, end }], locale } (areas from Track Data, for areaEntry/areaExit
// rules; locale is the user's Preferred Language's, e.g. pt-BR).
export async function GET(request: Request) {
  try {
    const user = await userContext(request);
    if (!user) {
      return NextResponse.json({ error: 'Missing or unknown upload key' }, { status: 401 });
    }
    const trackName = new URL(request.url).searchParams.get('track')?.trim() ?? '';
    const track = trackName ? findTrackByName(await readTracks(user.userId), trackName) : undefined;
    const areas = [...(track?.areas ?? [])]
      .sort((a, b) => a.position - b.position)
      .map((area) => ({ name: area.name, start: area.startPoint, end: area.endPoint }));

    const plan = await inCarCoachPlan(
      user.instructions,
      areas.map((area) => area.name),
      user.language
    );
    // The locale formats the numbers the collector puts in rule texts (e.g. 1:23,456 in pt-BR) for the voice
    return NextResponse.json({ instructions: user.instructions, plan, areas, locale: LANGUAGE_LOCALES[user.language] });
  } catch (error) {
    console.error('In-Car AI Coach plan error:', error);
    return aiErrorResponse(error, 'Failed to set up the In-Car AI Coach');
  }
}

const bodySchema = z.object({
  clientLapIds: z.array(z.uuid()).min(1).max(30),
  recentCallouts: z.array(z.string().max(300)).max(10).default([]),
});

// POST { clientLapIds, recentCallouts }: the session's laps uploaded so far (by clientLapId, oldest first) and what
// the coach said recently. Answers { callouts: [{ text, sound }] } (often empty: nothing new worth saying), or
// 404 when none of the laps have been uploaded.
export async function POST(request: Request) {
  try {
    const user = await userContext(request);
    if (!user) {
      return NextResponse.json({ error: 'Missing or unknown upload key' }, { status: 401 });
    }
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Expected { clientLapIds: [uuid, ...], recentCallouts: [string, ...] }' }, { status: 400 });
    }
    if (!process.env.OPENAI_API_KEY) {
      console.error('OPENAI_API_KEY is not configured');
      return NextResponse.json({ error: 'The AI coach isn’t available right now' }, { status: 500 });
    }

    const all = await readCollectorLapsByClientId(user.userId, parsed.data.clientLapIds);
    if (all.length === 0) {
      return NextResponse.json({ error: 'None of those laps have been uploaded' }, { status: 404 });
    }
    // One session is one track; the newest lap's
    const trackName = all[all.length - 1].track;
    const laps = all.filter((lap) => lap.track === trackName).map((lap) => ({ ...lap, id: lap.clientLapId.slice(-4) }));
    const userTrack = findTrackByName(await readTracks(user.userId), trackName);
    const session = userTrack
      ? measureDebriefSession(
          toLapTrack(userTrack),
          laps[0].car,
          laps.map((lap) => ({ id: lap.id, lapSeconds: lap.lapTimeSeconds, samples: lapSamplesFromText(lap.csv) }))
        )
      : null;

    const { callouts, steps } = await inCarCoachCallouts({
      instructions: user.instructions,
      track: trackName,
      car: laps[0].car,
      laps: laps.map((lap) => ({
        id: lap.id,
        lapNumber: lap.lapNumber,
        lapSeconds: lap.lapTimeSeconds,
        incidents: lap.incidents,
        offTrack: lap.offTrack,
      })),
      session,
      carRpmLimit: await carRpmLimit(user.userId, laps[0].car).catch(() => null),
      recentCallouts: parsed.data.recentCallouts,
      language: user.language,
      units: user.units,
    });
    console.log(`In-Car AI Coach: user ${user.userId}, ${laps.length} laps, ${callouts.length} callouts (${steps.join(', ') || 'no tools'})`);
    return NextResponse.json({ callouts });
  } catch (error) {
    console.error('In-Car AI Coach error:', error);
    return aiErrorResponse(error, 'Failed to coach these laps');
  }
}
