// The optional promo code typed on the Create an Account page, kept as typed in racingcoach."Users".promo_code
// and shown on the Subscribers page. It's only recorded: Stripe discounts are applied at checkout.

export const MAX_PROMO_CODE_LENGTH = 50;

// The code as typed, trimmed; null when blank or not a string
export function cleanPromoCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().slice(0, MAX_PROMO_CODE_LENGTH);
  return code || null;
}
