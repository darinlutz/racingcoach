import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDictionary } from '@/lib/i18n/server';
import { clientIp } from '@/lib/rateLimits';
import { getCurrentUser } from '@/lib/session';
import { approvePairing, overAttemptLimit } from '@/lib/tvAuth';
import { normalizePairingCode } from '@/lib/tvPairingCode';

const bodySchema = z.object({ code: z.string().max(40) });

// The TV Link page (src/app/tv/link/): the signed-in user typed the code their TV shows, so that TV may claim a TV
// session for their account (src/lib/tvAuth.ts). Answers { label } (what the TV is), 404 { code: 'badCode' } when no
// TV is waiting with it. At most TRIES codes every 10 minutes per account and per IP address, so codes can't be
// guessed.
const TRIES = 10;

export async function POST(request: Request) {
  const user = await getCurrentUser();
  const t = getDictionary(user?.preferredLanguage ?? 'en').tv;
  try {
    if (!user) {
      return NextResponse.json({ error: t.logIn }, { status: 401 });
    }
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Expected { code }' }, { status: 400 });
    }
    const window = 10 * 60_000;
    const overUser = overAttemptLimit(`tv-link:${user.id}`, TRIES, window);
    const overIp = overAttemptLimit(`tv-link-ip:${clientIp(request) ?? ''}`, TRIES * 3, window);
    if (overUser || overIp) {
      return NextResponse.json({ error: t.tooManyTries, code: 'tooManyTries' }, { status: 429 });
    }
    const code = normalizePairingCode(parsed.data.code);
    const approved = code ? await approvePairing(user.id, code) : null;
    if (!approved) {
      return NextResponse.json({ error: t.badCode, code: 'badCode' }, { status: 404 });
    }
    return NextResponse.json({ label: approved.label });
  } catch (error) {
    console.error('TV link error:', error);
    return NextResponse.json({ error: t.linkFailed }, { status: 500 });
  }
}
