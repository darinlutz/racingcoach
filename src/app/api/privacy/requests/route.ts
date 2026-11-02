import { NextResponse } from 'next/server';
import { transaction } from '@/lib/db';
import { fmt } from '@/lib/i18n/languages';
import { getDictionary, getLanguage } from '@/lib/i18n/server';
import { quietly, sendVerificationEmail } from '@/lib/privacyEmail';
import { countRecentRequestsByEmail, createRequest, createVerificationToken } from '@/lib/privacyRequests';
import { isRequestType, MAX_DETAILS_LENGTH, SUBMITTABLE_TYPES } from '@/lib/privacyRules';
import { clientIp } from '@/lib/rateLimits';
import { getPublicSiteUrl } from '@/lib/siteOrigin';
import { overAttemptLimit } from '@/lib/tvAuth';

// The public privacy request form (/privacy-request), for someone without an account, a former user, or someone who
// can't sign in. Body: { name, email, type, details }. The request is recorded as Pending Verification and a one-time
// link is emailed to the address; nothing is done until it's followed (/privacy-request/verify). The answer is the
// same whether or not the address has an account, so the form can't be used to find out who has one. Limited to 5
// requests an hour per IP address and 3 a day per email address.

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  const t = getDictionary(await getLanguage()).privacyRights;
  try {
    const body = await request.json().catch(() => ({}));
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const details = typeof body.details === 'string' ? body.details.trim() : '';
    if (!isRequestType(body.type) || !SUBMITTABLE_TYPES.includes(body.type)) {
      return NextResponse.json({ error: t.errors.invalidType }, { status: 400 });
    }
    if (!EMAIL_PATTERN.test(email) || email.length > 320) {
      return NextResponse.json({ error: t.errors.invalidEmail }, { status: 400 });
    }
    if (!name || name.length > 200) {
      return NextResponse.json({ error: fmt(t.errors.invalidName, { max: 200 }) }, { status: 400 });
    }
    if (!details) return NextResponse.json({ error: t.errors.detailsRequired }, { status: 400 });
    if (details.length > MAX_DETAILS_LENGTH) {
      return NextResponse.json({ error: fmt(t.errors.tooLong, { max: MAX_DETAILS_LENGTH }) }, { status: 400 });
    }
    if (overAttemptLimit(`privacy-public:${clientIp(request) ?? 'unknown'}`, 5, 60 * 60 * 1000)) {
      return NextResponse.json({ error: t.errors.tooManyRequests }, { status: 429 });
    }
    // Over the per-address limit, answer as if it worked, so the form can't be used to flood someone's inbox
    if ((await countRecentRequestsByEmail(email, 24)) >= 3) {
      return NextResponse.json({ message: t.public.sent });
    }

    const { requestId, token } = await transaction(async (client) => {
      const created = await createRequest(client, {
        userId: null,
        requesterName: name,
        requesterEmail: email,
        type: body.type,
        details,
        verifiedBy: null,
      });
      return { requestId: created.id, token: await createVerificationToken(client, created.id) };
    });
    const link = `${getPublicSiteUrl(request)}/privacy-request/verify?token=${encodeURIComponent(token)}`;
    await quietly(sendVerificationEmail(email, { requestId, type: body.type, link }), 'verification');
    return NextResponse.json({ message: t.public.sent });
  } catch (error) {
    console.error('Public privacy request error:', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: t.errors.failed }, { status: 500 });
  }
}
