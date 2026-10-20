import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getCurrentUser } from '@/lib/session';
import { getSiteOrigin } from '@/lib/siteOrigin';
import { getPlanPrice, getStripeConfig, STRIPE_APP } from '@/lib/stripePlans';
import { ACCOUNT_STATUS, isPlan } from '@/lib/accountStatus';
import { canBuy } from '@/lib/users';
import { apiText } from '@/lib/i18n/server';

export async function POST(request: Request) {
  const t = await apiText();
  try {
    const formData = await request.formData();
    const plan = formData.get('plan');
    if (!isPlan(plan)) {
      return NextResponse.json({ error: t.invalidPlan }, { status: 400 });
    }

    // Check if Stripe secret key and the plan's product are configured
    const config = getStripeConfig(plan);
    if (!config) {
      return NextResponse.json(
        { error: t.notConfigured },
        { status: 500 }
      );
    }
    const { stripe, productId } = config;

    const origin = getSiteOrigin(request);

    // The webhook uses client_reference_id to find which user subscribed
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.redirect(`${origin}/login`, 303);
    }
    // Prevents buying a plan the account already has (or one below it): a current
    // subscriber can only upgrade, from Silver to Gold
    if (!canBuy(user, plan)) {
      return NextResponse.redirect(`${origin}/account`, 303);
    }
    // An upgrade replaces the current subscription: the webhook cancels it once the
    // new one is paid for. Using the same Stripe customer keeps both on one record.
    const replacesSubscription =
      user.accountStatus === ACCOUNT_STATUS.subscribed ? user.stripeSubscriptionId : null;
    const customer = replacesSubscription ? user.stripeCustomerId : null;

    // Every plan (Silver or Gold, Monthly or Annual) is a recurring subscription
    const price = await getPlanPrice(stripe, productId);
    if (!price || price.type !== 'recurring') {
      console.error(`Stripe product ${productId} has no recurring default price`);
      return NextResponse.json(
        { error: t.notConfigured },
        { status: 500 }
      );
    }

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      ui_mode: 'hosted_page',
      mode: 'subscription',
      payment_method_collection: 'always',
      billing_address_collection: 'auto',
      phone_number_collection: { enabled: false },
      automatic_tax: { enabled: false },
      // Stripe's checkout page takes a promotion code (made in the Stripe Dashboard), checks that it's active, not
      // expired or used up and meets its restrictions, and shows the discounted price before paying. The webhook
      // records the code from Stripe, never from the browser.
      allow_promotion_codes: true,
      submit_type: 'auto',
      integration_identifier: 'hosted_web_0001',
      origin_context: 'web',
      client_reference_id: String(user.id),
      ...(customer ? { customer } : { customer_email: user.emailAddress }),
      success_url: `${origin}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/account`,
      line_items: [{ price: price.id, quantity: 1 }],
      // The webhook reads the plan to decide how to update the account, cancels
      // the subscription an upgrade replaces, and skips sessions whose app isn't this one
      metadata: {
        plan,
        app: STRIPE_APP,
        ...(replacesSubscription ? { replaces_subscription: replacesSubscription } : {}),
      },
      // The subscription carries them too, so its own events (which reach TalkNinja's webhook as well) say which
      // app and account it belongs to (src/lib/stripeBilling.ts)
      subscription_data: {
        metadata: { app: STRIPE_APP, plan, user_id: String(user.id) },
      },
    };

    const session = await stripe.checkout.sessions.create(sessionParams);

    if (!session.url) {
      return NextResponse.json(
        { error: t.failedCheckout },
        { status: 500 }
      );
    }

    return NextResponse.redirect(session.url, 303);
  } catch (error) {
    console.error('Stripe checkout error:', error);

    return NextResponse.json(
      { error: t.failedCheckout },
      { status: 500 }
    );
  }
}
