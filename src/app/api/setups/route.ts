import { NextResponse } from 'next/server';
import { ABUSE_LIMITS, limitReached, recordAttempt } from '@/lib/abuseGuards';
import { readEngineerSnapshot } from '@/lib/liveRacing';
import { BodyTooLargeError, readFormDataLimited } from '@/lib/requestBody';
import { setupErrorResponse, setupsSession } from '@/lib/setupRoutes';
import { createStoSetup, listSetups, readOverview } from '@/lib/setups';
import { cleanStoFileName, MAX_STO_BYTES } from '@/lib/stoFile';

// The Setups page (docs/setups.md). GET: the signed-in user's setups and the Overview's figures, with whether their
// collector is in iRacing right now. POST (multipart: file, and optionally car and track): upload a .sto, kept
// byte for byte; its container is read (stoFile.ts) but its values are encrypted, so they come from the collector's
// capture once iRacing loads it.
export async function GET() {
  const session = await setupsSession();
  if (session.response) return session.response;
  try {
    const [setups, overview] = await Promise.all([listSetups(session.user.id), readOverview(session.user.id)]);
    const live = readEngineerSnapshot(session.user.id);
    return NextResponse.json({
      setups,
      overview,
      collector: live ? { live: true, car: live.update.car, track: live.update.track, at: new Date(live.receivedAt).toISOString() } : { live: false },
    });
  } catch (error) {
    return setupErrorResponse(error, session.t, 'Setups list');
  }
}

const text = (value: FormDataEntryValue | null, max: number) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null);

export async function POST(request: Request) {
  const session = await setupsSession();
  if (session.response) return session.response;
  const { user, t } = session;
  try {
    const key = `setup-uploads:${user.id}`;
    if (limitReached(key, ABUSE_LIMITS.setupUploadsPerHour)) return NextResponse.json({ error: t.tooFast }, { status: 429 });
    recordAttempt(key);
    const form = await readFormDataLimited(request, MAX_STO_BYTES + 16 * 1024).catch((error) => {
      if (error instanceof BodyTooLargeError) return 'tooLarge' as const;
      return null;
    });
    if (form === 'tooLarge') return NextResponse.json({ error: t.tooLarge }, { status: 413 });
    const file = form?.get('file');
    if (!form || !(file instanceof File)) return NextResponse.json({ error: t.notSto }, { status: 400 });
    const fileName = cleanStoFileName(file.name);
    if (!fileName) return NextResponse.json({ error: t.notSto }, { status: 400 });
    if (file.size > MAX_STO_BYTES || file.size === 0) return NextResponse.json({ error: t.tooLarge }, { status: 413 });
    const bytes = Buffer.from(await file.arrayBuffer());
    const result = await createStoSetup(user.id, {
      fileName,
      bytes,
      car: text(form.get('car'), 200),
      track: text(form.get('track'), 200),
    });
    return NextResponse.json({ setupId: result.setupId, duplicate: result.duplicate, status: result.info.status }, { status: result.duplicate ? 200 : 201 });
  } catch (error) {
    return setupErrorResponse(error, t, 'Setup upload');
  }
}
