import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { billingPortalUrl } from '@/lib/billingPortal';
import type { Language } from '@/lib/i18n/languages';
import { getCurrentUser } from '@/lib/session';
import { getPublicSiteUrl } from '@/lib/siteOrigin';
import { stripeClient } from '@/lib/stripePlans';

// The Account page's Manage Billing form: opens Stripe's customer portal (src/lib/billingPortal.ts) for the signed-in
// user's own Stripe customer, never anyone else's (it comes from their account, not the request). Answers a 303 to
// the portal, or back to the Account page with ?billing=unavailable when there's nothing to manage or Stripe fails.
const PORTAL_LOCALES: Record<Language, Stripe.BillingPortal.SessionCreateParams.Locale> = {
  en: 'en',
  pt: 'pt-BR',
  es: 'es-419',
  de: 'de',
};

export async function POST(request: Request) {
  const siteUrl = getPublicSiteUrl(request);
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(`${siteUrl}/login?next=/account`, 303);
  const back = `${siteUrl}/account?billing=unavailable#subscription`;
  const stripe = stripeClient();
  if (!user.stripeCustomerId || !stripe) return NextResponse.redirect(back, 303);
  try {
    const url = await billingPortalUrl(stripe, user.stripeCustomerId, siteUrl, PORTAL_LOCALES[user.preferredLanguage] ?? 'auto');
    return NextResponse.redirect(url, 303);
  } catch (error) {
    console.error('Billing portal error:', error);
    return NextResponse.redirect(back, 303);
  }
}
