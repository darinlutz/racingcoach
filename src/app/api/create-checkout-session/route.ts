import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getCurrentUser } from '@/lib/session';
import { getSiteOrigin } from '@/lib/siteOrigin';
import { getPlanPrice, getStripeConfig, isPlan, STRIPE_APP } from '@/lib/stripePlans';
import { canBuy } from '@/lib/users';

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const plan = formData.get('plan');
    if (!isPlan(plan)) {
      return NextResponse.json({ error: 'Invalid plan' }, { status: 400 });
    }

    // Check if Stripe secret key and the plan's product are configured
    const config = getStripeConfig(plan);
    if (!config) {
      return NextResponse.json(
        { error: 'Stripe is not configured' },
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
    // Prevents subscribing an account that's already Subscribed
    if (!canBuy(user)) {
      return NextResponse.redirect(`${origin}/account`, 303);
    }

    // Both plans (Monthly and Annual) are recurring subscriptions
    const price = await getPlanPrice(stripe, productId);
    if (!price || price.type !== 'recurring') {
      console.error(`Stripe product ${productId} has no recurring default price`);
      return NextResponse.json(
        { error: 'Stripe product has no recurring price' },
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
      allow_promotion_codes: false,
      submit_type: 'auto',
      integration_identifier: 'hosted_web_0001',
      origin_context: 'web',
      client_reference_id: String(user.id),
      customer_email: user.emailAddress,
      success_url: `${origin}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/account`,
      line_items: [{ price: price.id, quantity: 1 }],
      // The webhook reads the plan to decide how to update the account, and
      // skips sessions whose app isn't this one
      metadata: { plan, app: STRIPE_APP },
    };

    const session = await stripe.checkout.sessions.create(sessionParams);

    if (!session.url) {
      return NextResponse.json(
        { error: 'Checkout session has no URL' },
        { status: 500 }
      );
    }

    return NextResponse.redirect(session.url, 303);
  } catch (error) {
    console.error('Stripe checkout error:', error);

    return NextResponse.json(
      { error: 'Failed to create checkout session' },
      { status: 500 }
    );
  }
}
