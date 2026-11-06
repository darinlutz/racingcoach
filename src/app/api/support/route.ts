import { NextResponse } from 'next/server';
import { ABUSE_LIMITS, checkFormGuard, ipKey, limitReached, recordAttempt } from '@/lib/abuseGuards';
import { fmt } from '@/lib/i18n/languages';
import { getDictionary, getLanguage } from '@/lib/i18n/server';
import { getCurrentUser } from '@/lib/session';
import { MAX_SUPPORT_DESCRIPTION, sendSupportRequest } from '@/lib/supportRequest';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SUPPORT_DAILY_KEY = 'support-daily';

// The Support page's Send Report. Body: { name, email, description, formTrap, formMs }. Open to visitors too, since
// someone who can't sign in may need help; the email only ever goes to the site owner. Limited per IP address and
// in all per day, and the form's trap field and fill time keep out bots (src/lib/abuseGuards.ts).
export async function POST(request: Request) {
  const dictionary = getDictionary(await getLanguage(await getCurrentUser()));
  const t = dictionary.support;
  const api = dictionary.api;
  try {
    const body = await request.json().catch(() => ({}));
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const description = typeof body.description === 'string' ? body.description.trim() : '';
    if (!name || !EMAIL_PATTERN.test(email) || !description) {
      return NextResponse.json({ error: t.missingFields }, { status: 400 });
    }
    if (description.length > MAX_SUPPORT_DESCRIPTION || name.length > 200 || email.length > 320) {
      return NextResponse.json({ error: fmt(t.tooLong, { max: MAX_SUPPORT_DESCRIPTION }) }, { status: 400 });
    }

    // Spam guards (src/lib/abuseGuards.ts). A filled-in trap field is a bot: answer as if sent, so it learns nothing
    const guard = checkFormGuard(body);
    if (guard === 'trap') return NextResponse.json({ success: true });
    if (guard === 'tooFast') return NextResponse.json({ error: api.formTooFast }, { status: 400 });
    const ip = `support-ip:${ipKey(request)}`;
    if (limitReached(ip, ABUSE_LIMITS.supportPerIp)) {
      return NextResponse.json({ error: t.tooManyReports }, { status: 429 });
    }
    // However many addresses it comes from, the owner's inbox and the Resend quota get at most this many a day
    if (limitReached(SUPPORT_DAILY_KEY, ABUSE_LIMITS.supportPerDay)) {
      console.warn('Support request refused: daily cap reached');
      return NextResponse.json({ error: t.supportBusy }, { status: 429 });
    }

    await sendSupportRequest({ name, email, description });
    recordAttempt(ip);
    recordAttempt(SUPPORT_DAILY_KEY);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Support request error:', error);
    return NextResponse.json({ error: t.failed }, { status: 500 });
  }
}
