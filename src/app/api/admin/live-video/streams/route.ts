import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ABUSE_LIMITS, limitReached, recordAttempt } from '@/lib/abuseGuards';
import { apiText, getDictionary } from '@/lib/i18n/server';
import { createLiveInput, deleteLiveInput, readLiveInput, streamSetup } from '@/lib/liveVideo/cloudflareStream';
import { isLiveInputId } from '@/lib/liveVideo/streamRules';
import { addStream, listStreams, StreamLimitError } from '@/lib/liveVideoDb';
import { JSON_BODY_LIMIT, readJsonLimited } from '@/lib/requestBody';
import { isAdmin } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import { getUserByEmail } from '@/lib/users';

// Adds a live stream for a driver's account (docs/live-video.md). { email, name, requireSigned, inputId? }:
//   - with inputId: a live input made in the Cloudflare dashboard, checked with the API when it's configured
//   - without: a new live input made through the API (recording off), which needs Stream Edit
// The answer carries the RTMPS URL but never the stream key: OBS gets the key from the Cloudflare dashboard. At most
// MAX_LIVE_STREAMS streams, one per driver; creating inputs is rate limited per Admin. Admin role only; 404 otherwise.

const bodySchema = z.object({
  email: z.string().trim().email().max(320),
  name: z.string().trim().min(1).max(100),
  requireSigned: z.boolean().default(false),
  inputId: z.string().trim().toLowerCase().optional(),
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  const t = await apiText(user);
  try {
    if (!user || !isAdmin(user.role)) return NextResponse.json({ error: t.adminOnly }, { status: 404 });
    const v = getDictionary(user.preferredLanguage).liveVideo.api;
    const parsed = bodySchema.safeParse(await readJsonLimited(request, JSON_BODY_LIMIT).catch(() => null));
    if (!parsed.success || (parsed.data.inputId && !isLiveInputId(parsed.data.inputId))) {
      return NextResponse.json({ error: v.invalidDetails }, { status: 400 });
    }
    const { email, name, requireSigned, inputId } = parsed.data;
    const key = `liveVideoInputs:${user.id}`;
    if (limitReached(key, ABUSE_LIMITS.liveVideoInputsPerAdmin)) return NextResponse.json({ error: v.tooMany }, { status: 429 });
    const owner = await getUserByEmail(email);
    if (!owner) return NextResponse.json({ error: t.userNotFound }, { status: 404 });
    const existing = await listStreams();
    if (existing.some((s) => s.userId === owner.id)) return NextResponse.json({ error: v.driverHasStream }, { status: 409 });
    if (inputId && existing.some((s) => s.inputId === inputId)) return NextResponse.json({ error: v.duplicateInput }, { status: 409 });
    const setup = streamSetup();
    if (!inputId && !setup.api) return NextResponse.json({ error: v.apiNotConfigured }, { status: 409 });
    if (requireSigned && !setup.signing) return NextResponse.json({ error: v.signingNotConfigured }, { status: 409 });
    recordAttempt(key);

    let uid = inputId ?? null;
    let rtmpsUrl: string | null = null;
    let created = false;
    try {
      if (uid) {
        if (setup.api) rtmpsUrl = (await readLiveInput(uid)).rtmpsUrl;
      } else {
        const input = await createLiveInput(name, requireSigned);
        uid = input.uid;
        rtmpsUrl = input.rtmpsUrl;
        created = true;
      }
    } catch (error) {
      console.error('Live video Cloudflare error:', error instanceof Error ? error.message : error);
      return NextResponse.json({ error: inputId ? v.inputNotFound : v.cloudflareFailed }, { status: 502 });
    }
    try {
      const stream = await addStream({ userId: owner.id, name, inputId: uid!, requireSigned, createdVia: created ? 'api' : 'registered', createdBy: user.id });
      console.log(`Live video: stream ${stream.id} for user ${owner.id} ${created ? 'created' : 'registered'} by user ${user.id}`);
      return NextResponse.json({ stream, rtmpsUrl });
    } catch (error) {
      // Don't leave an input nobody can see in the account
      if (created) await deleteLiveInput(uid!).catch(() => undefined);
      if (error instanceof StreamLimitError) return NextResponse.json({ error: v.streamLimit }, { status: 409 });
      throw error;
    }
  } catch (error) {
    console.error('Live video add stream error:', error);
    return NextResponse.json({ error: t.failedSaveSetting }, { status: 500 });
  }
}
