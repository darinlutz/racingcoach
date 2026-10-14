import { NextResponse } from 'next/server';
import { fmt } from '@/lib/i18n/languages';
import { getDictionary, getLanguage } from '@/lib/i18n/server';
import { getCurrentUser } from '@/lib/session';
import { MAX_SUPPORT_DESCRIPTION, sendSupportRequest } from '@/lib/supportRequest';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The Support page's Send Report. Body: { name, email, description }. Open to visitors too, since
// someone who can't sign in may need help; the email only ever goes to the site owner.
export async function POST(request: Request) {
  const t = getDictionary(await getLanguage(await getCurrentUser())).support;
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

    await sendSupportRequest({ name, email, description });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Support request error:', error);
    return NextResponse.json({ error: t.failed }, { status: 500 });
  }
}
