import Stripe from 'stripe';
import type { Plan } from './accountStatus';

// Tags this app's Checkout Sessions (metadata.app). The Stripe account is shared
// with TalkNinja, whose webhook endpoint also receives these events, so each app's
// webhook ignores Checkout Sessions not tagged as its own.
export const STRIPE_APP = 'racingcoach';

// Each plan is a Stripe Product; Checkout charges its default (recurring) Price
const PLAN_PRODUCT_ENV: Record<Plan, string> = {
  monthly: 'RACINGCOACH_MONTHLY_PRODUCT_ID',
  annual: 'RACINGCOACH_ANNUAL_PRODUCT_ID',
};

export function isPlan(value: unknown): value is Plan {
  return value === 'monthly' || value === 'annual';
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

// How much cheaper the annual price is than 12 monthly payments, as a whole
// percent (e.g. 17), or null if the prices can't be compared or there's no saving
export function annualDiscountPercent(monthly: Stripe.Price, annual: Stripe.Price): number | null {
  if (monthly.unit_amount == null || annual.unit_amount == null || monthly.currency !== annual.currency) {
    return null;
  }
  const twelveMonths = monthly.unit_amount * 12;
  if (twelveMonths <= 0) return null;
  const percent = Math.round((1 - annual.unit_amount / twelveMonths) * 100);
  return percent > 0 ? percent : null;
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
