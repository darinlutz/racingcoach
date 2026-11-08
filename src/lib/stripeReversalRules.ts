// Which Stripe events take a payment back (docs: AGENTS.md, Stripe), so the paid access it bought ends at once
// (revokeForReversedPayment in src/lib/stripeBilling.ts). No imports, so tests run it directly.
//
// - charge.dispute.created: the customer disputed the charge with their bank (a chargeback). Any dispute, whatever its
//   amount or reason, as the money is held from the moment it opens.
// - charge.refunded: only a full refund (the charge's `refunded`). A partial refund is a goodwill credit given in the
//   Dashboard, which leaves the subscription alone.
//
// A dispute that's later won (charge.dispute.closed) doesn't give the access back: the subscription was canceled, and
// the customer subscribes again if they want to.

export type ReversalReason = 'disputed' | 'refunded';

export type PaymentReversal = { reason: ReversalReason; paymentIntentId: string; chargeId: string | null };

type Id = string | { id: string } | null | undefined;
const idOf = (value: Id) => (value == null ? null : typeof value === 'string' ? value : value.id);

type ReversalEvent =
  | { type: 'charge.dispute.created'; data: { object: { charge: Id; payment_intent: Id } } }
  | { type: 'charge.refunded'; data: { object: { id: string; refunded: boolean; payment_intent: Id } } }
  | { type: string; data: { object: unknown } };

export function paymentReversal(event: ReversalEvent): PaymentReversal | null {
  if (event.type === 'charge.dispute.created') {
    const dispute = event.data.object as { charge: Id; payment_intent: Id };
    const paymentIntentId = idOf(dispute.payment_intent);
    return paymentIntentId ? { reason: 'disputed', paymentIntentId, chargeId: idOf(dispute.charge) } : null;
  }
  if (event.type === 'charge.refunded') {
    const charge = event.data.object as { id: string; refunded: boolean; payment_intent: Id };
    const paymentIntentId = idOf(charge.payment_intent);
    if (!charge.refunded || !paymentIntentId) return null;
    return { reason: 'refunded', paymentIntentId, chargeId: charge.id };
  }
  return null;
}
