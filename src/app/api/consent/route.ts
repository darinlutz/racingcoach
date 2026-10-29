import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  CONSENT_BANNER_VERSION,
  CONSENT_METHODS,
  CONSENT_PURPOSES_VERSION,
  CONSENT_VIAS,
  COOKIE_POLICY_VERSION,
  allChoices,
  consentAction,
  grantsAny,
  normalizeChoices,
} from '@/lib/cookieConsent';
import { recordCookieConsent } from '@/lib/cookieConsentRecords';
import { deleteRefusedCookies, getConsentState, setConsentCookie } from '@/lib/cookieConsentServer';
import { isLanguage } from '@/lib/i18n/languages';
import { getCurrentUser } from '@/lib/session';
import { getSiteOrigin } from '@/lib/siteOrigin';

const consentSchema = z.object({
  via: z.enum(CONSENT_VIAS),
  method: z.enum(CONSENT_METHODS),
  // Only read for Save Preferences; Accept All and Reject All set every category
  choices: z.record(z.string(), z.boolean()).optional(),
  language: z.string().max(10).optional(),
});

// Saves a choice made in the cookie banner or preference center (src/components/CookieConsentProvider.tsx): records
// it in racingcoach."CookieConsents", stores it in the consent cookie and deletes the cookies of the categories
// refused. Open to visitors who aren't signed in. A refusal is always applied, even if it can't be recorded; a grant
// isn't, as there'd be no evidence of it.
export async function POST(request: Request) {
  // Only the site's own pages: a cross-site form can't send JSON, and a browser's Origin, when sent, must be this site
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return NextResponse.json({ error: 'Body must be JSON' }, { status: 415 });
  }
  const origin = request.headers.get('origin');
  if (origin && origin !== getSiteOrigin(request)) {
    return NextResponse.json({ error: 'Cross-site request refused' }, { status: 403 });
  }

  const parsed = consentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid consent choice' }, { status: 400 });
  }
  const { via, method, language } = parsed.data;
  const choices =
    via === 'acceptAll' ? allChoices(true) : via === 'rejectAll' ? allChoices(false) : normalizeChoices(parsed.data.choices);

  const state = await getConsentState();
  const previous = state.current ? state.stored : null;
  const action = consentAction(previous, choices, via);
  const consent = {
    // The same pseudonymous ID for every choice this browser makes, so the records show its history
    browserId: state.stored?.browserId ?? randomUUID(),
    recordId: randomUUID(),
    purposesVersion: CONSENT_PURPOSES_VERSION,
    choices,
    decidedAt: Date.now(),
  };

  let recorded = true;
  try {
    const user = await getCurrentUser();
    await recordCookieConsent({
      id: consent.recordId,
      browserId: consent.browserId,
      userId: user?.id ?? null,
      action,
      choices,
      cookiePolicyVersion: COOKIE_POLICY_VERSION,
      bannerVersion: CONSENT_BANNER_VERSION,
      purposesVersion: CONSENT_PURPOSES_VERSION,
      language: isLanguage(language) ? language : 'en',
      region: state.region,
      country: state.country,
      method,
    });
  } catch (error) {
    console.error('Cookie consent record error:', error);
    recorded = false;
    if (grantsAny(choices)) {
      return NextResponse.json({ error: 'Failed to save your cookie choices' }, { status: 500 });
    }
  }

  await setConsentCookie(consent);
  await deleteRefusedCookies(choices);
  return NextResponse.json({ choices, action, recorded });
}
