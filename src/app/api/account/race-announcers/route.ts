import { NextResponse } from 'next/server';
import { getCoachVoice, isCoachVoice } from '@/lib/coachVoice';
import { broadcastSettingsPatch } from '@/lib/broadcastSettings';
import { apiText } from '@/lib/i18n/server';
import {
  announcerVoicesFor,
  isAnnouncer,
  MAX_RACE_ANNOUNCER_INSTRUCTIONS,
  setAnnouncerVoice,
  setBroadcastSettings,
  setRaceAnnouncerInstructions,
} from '@/lib/raceAnnouncer';
import { getCurrentUser } from '@/lib/session';
import { getEnableAiFeatures } from '@/lib/siteSettings';

// The Account page's Race Announcers (src/lib/raceAnnouncer.ts), saved for the signed-in user only.
// Body: { announcer: 'lead' | 'color', voice } (one of announcerVoicesFor the user's language and Spanish accent), or
// { instructions } (the Race Announcer Instructions; empty clears them), or { broadcast } (some of the Race Broadcast
// preferences, src/lib/broadcastSettings.ts; answers them all). Only while the Admin page's Enable AI Features is on.
export async function PUT(request: Request) {
  const user = await getCurrentUser();
  const t = await apiText(user);
  try {
    if (!user) {
      return NextResponse.json({ error: t.logInRaceAnnouncers }, { status: 401 });
    }
    if (!(await getEnableAiFeatures())) {
      return NextResponse.json({ error: t.raceAnnouncersDisabled, code: 'aiFeaturesDisabled' }, { status: 403 });
    }
    const body = await request.json().catch(() => ({}));

    if (body.broadcast !== undefined) {
      const patch = broadcastSettingsPatch(body.broadcast);
      if (!patch) {
        return NextResponse.json({ error: t.failedSaveRaceAnnouncers }, { status: 400 });
      }
      return NextResponse.json({ broadcast: await setBroadcastSettings(user.id, patch) });
    }

    if (body.instructions !== undefined) {
      if (typeof body.instructions !== 'string') {
        return NextResponse.json({ error: t.failedSaveRaceAnnouncers }, { status: 400 });
      }
      const instructions = body.instructions.trim();
      if (instructions.length > MAX_RACE_ANNOUNCER_INSTRUCTIONS) {
        return NextResponse.json({ error: t.raceAnnouncerInstructionsTooLong }, { status: 400 });
      }
      await setRaceAnnouncerInstructions(user.id, instructions);
      return NextResponse.json({ instructions });
    }

    const { spanishAccent } = await getCoachVoice(user.id);
    if (
      !isAnnouncer(body.announcer) ||
      !isCoachVoice(body.voice) ||
      !(body.voice in announcerVoicesFor(body.announcer, user.preferredLanguage, spanishAccent))
    ) {
      return NextResponse.json({ error: t.unknownCoachVoice }, { status: 400 });
    }
    await setAnnouncerVoice(user.id, body.announcer, body.voice);
    return NextResponse.json({ announcer: body.announcer, voice: body.voice });
  } catch (error) {
    console.error('Race Announcers error:', error);
    return NextResponse.json({ error: t.failedSaveRaceAnnouncers }, { status: 500 });
  }
}
