import Stripe from 'stripe';
import type { Plan } from './accountStatus';

// Tags this app's Checkout Sessions (metadata.app). The Stripe account is shared
// with TalkNinja, whose webhook endpoint also receives these events, so each app's
// webhook ignores Checkout Sessions not tagged as its own.
export const STRIPE_APP = 'racingcoach';

// Each plan is a Stripe Product; Checkout charges its default Price
const PLAN_PRODUCT_ENV: Record<Plan, string> = {
  monthly: 'STRIPE_COACHING_MONTHLY_PRODUCT_ID',
  lifetime: 'STRIPE_COACHING_LIFETIME_PRODUCT_ID',
};

export function isPlan(value: unknown): value is Plan {
  return value === 'monthly' || value === 'lifetime';
}

// null when the secret key or the plan's product isn't configured
export function getStripeConfig(plan: Plan): { stripe: Stripe; productId: string } | null {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  const productId = process.env[PLAN_PRODUCT_ENV[plan]];
  if (!stripeSecretKey || !productId) return null;
  return { stripe: new Stripe(stripeSecretKey), productId };
}

// The plan product's default Price, or null if the product has none
export async function getPlanPrice(stripe: Stripe, productId: string): Promise<Stripe.Price | null> {
  const product = await stripe.products.retrieve(productId, {
    expand: ['default_price'],
  });
  const price = product.default_price;
  return price && typeof price !== 'string' ? price : null;
}

// e.g. "$9.99", or "$9" for whole amounts
export function formatPrice(price: Stripe.Price): string | null {
  if (price.unit_amount == null) return null;
  const amount = price.unit_amount / 100;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: price.currency,
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
  }).format(amount);
}
