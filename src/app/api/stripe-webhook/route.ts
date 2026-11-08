import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getUserById, setStatusBySubscriptionId, startSubscription } from '@/lib/users';
import { ACCOUNT_STATUS, parsePlan, type Plan } from '@/lib/accountStatus';
import { notifyOwner } from '@/lib/ownerNotifications';
import { STRIPE_APP } from '@/lib/stripePlans';
import { readTextLimited } from '@/lib/requestBody';
import {
  claimWebhookEvent,
  finishWebhookEvent,
  releaseWebhookEvent,
  revokeForReversedPayment,
  syncSubscription,
} from '@/lib/stripeBilling';
import { paymentReversal } from '@/lib/stripeReversalRules';

export async function POST(request: Request) {
  // Check if Stripe keys are configured
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripeSecretKey || !webhookSecret) {
    console.error('Stripe webhook is not configured');
    return NextResponse.json(
      { error: 'Stripe webhook is not configured' },
      { status: 500 }
    );
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json(
      { error: 'Missing Stripe signature' },
      { status: 400 }
    );
  }

  const stripe = new Stripe(stripeSecretKey, { maxNetworkRetries: 2 });

  // Signature verification needs the raw, unparsed body
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      await readTextLimited(request, 1024 * 1024),
      signature,
      webhookSecret
    );
  } catch (error) {
    console.error('Stripe webhook signature verification failed:', error);
    return NextResponse.json(
      { error: 'Invalid signature' },
      { status: 400 }
    );
  }

  // Stripe can deliver an event more than once; each is handled once (src/lib/stripeBilling.ts)
  try {
    const claim = await claimWebhookEvent(event);
    if (claim === 'done') return NextResponse.json({ received: true, duplicate: true });
    if (claim === 'busy') {
      return NextResponse.json({ error: 'Event is being handled' }, { status: 409 });
    }
  } catch (error) {
    console.error('Stripe webhook claim error:', error);
    return NextResponse.json({ error: 'Webhook handling failed' }, { status: 500 });
  }

  try {
    switch (event.type) {
      // First payment: start a Silver or Gold subscription (account status Subscribed). An
      // upgrade from Silver to Gold then cancels the Silver subscription it replaces.
      case 'checkout.session.completed': {
        const session = event.data.object;
        // Another app's session on the shared Stripe account: its user IDs aren't ours
        if (session.metadata?.app !== STRIPE_APP) {
          console.log('Ignoring Checkout Session from another app:', session.id);
          break;
        }
        const userId = Number(session.client_reference_id);
        const plan = parsePlan(session.metadata?.plan);
        if (
          session.mode !== 'subscription' ||
          !plan ||
          !Number.isInteger(userId) ||
          typeof session.customer !== 'string' ||
          typeof session.subscription !== 'string'
        ) {
          console.warn('Checkout session not linked to a user:', session.id);
          break;
        }
        // Subscription mode sessions only complete once the first payment succeeds
        // The account moves to the new subscription first, so the old one's
        // customer.subscription.deleted event no longer matches it
        await startSubscription(userId, session.customer, session.subscription, plan);
        const replaced = session.metadata?.replaces_subscription;
        if (replaced && replaced !== session.subscription) {
          await cancelReplacedSubscription(stripe, replaced, plan);
        }
        // The Subscribers page's copy, with the promotion code entered at checkout (session.discounts)
        await syncSubscription(stripe, session.subscription, { userId, checkoutSession: session });
        await notifyOwnerOfPurchase(plan, userId);
        break;
      }
      // A payment went through (a renewal, or a failed one recovered): syncSubscription reads the subscription from
      // Stripe and brings the account to it (Subscribed, the plan's level, the end of the paid period), so a late or
      // repeated delivery can't revive a canceled account or move the date back
      case 'invoice.paid': {
        const invoice = event.data.object;
        const subscription = invoice.parent?.subscription_details?.subscription;
        if (!subscription) break;
        const subscriptionId = typeof subscription === 'string' ? subscription : subscription.id;
        await syncSubscription(stripe, subscriptionId, { invoiceIds: [invoice.id] });
        break;
      }
      // A payment failed: the Subscribers page shows it (Stripe retries, then cancels per the Dashboard's settings)
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const subscription = invoice.parent?.subscription_details?.subscription;
        if (!subscription) break;
        await syncSubscription(stripe, typeof subscription === 'string' ? subscription : subscription.id, {
          invoiceIds: [invoice.id],
          paymentFailedAt: new Date(event.created * 1000),
        });
        break;
      }
      // Created, or changed (a plan change, a discount added or removed, a cancellation scheduled...): the
      // Subscribers page's copy is refreshed from Stripe
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        await syncSubscription(stripe, event.data.object.id);
        break;
      }
      // Subscription ended (canceled here, in the Dashboard, or after failed payments)
      case 'customer.subscription.deleted': {
        await setStatusBySubscriptionId(event.data.object.id, ACCOUNT_STATUS.canceled);
        await syncSubscription(stripe, event.data.object.id);
        break;
      }
      // A payment taken back: a dispute (chargeback) or a full refund ends the paid access it bought at once
      // (src/lib/stripeReversalRules.ts): its subscription is canceled and the account goes back to Bronze
      case 'charge.dispute.created':
      case 'charge.refunded': {
        const reversal = paymentReversal(event);
        if (!reversal) break;
        const result = await revokeForReversedPayment(stripe, reversal);
        if (result.status === 'ignored') {
          console.log(`Stripe ${reversal.reason} payment not for one of this app's subscriptions:`, reversal.paymentIntentId);
          break;
        }
        console.warn(`Stripe payment ${reversal.reason}: subscription ${result.subscriptionId} canceled (${result.status})`);
        // The Subscribers page's copy, now canceled
        await syncSubscription(stripe, result.subscriptionId!);
        if (result.userId) await notifyOwnerOfReversal(reversal.reason, result.userId);
        break;
      }
      default:
        console.log('Unhandled Stripe event type:', event.type);
    }
  } catch (error) {
    // A non-2xx response makes Stripe retry the event later
    console.error('Stripe webhook handling error:', error);
    await releaseWebhookEvent(event.id).catch((releaseError) =>
      console.error('Stripe webhook release error:', releaseError)
    );
    return NextResponse.json(
      { error: 'Webhook handling failed' },
      { status: 500 }
    );
  }

  await finishWebhookEvent(event.id).catch((error) => console.error('Stripe webhook finish error:', error));
  return NextResponse.json({ received: true });
}

// Cancels the subscription an upgrade replaced, right away. The unused part of it is
// credited (prorated) to the customer's balance, which Stripe takes off their next invoice.
// Throws on failure so Stripe retries the event; startSubscription is safe to repeat.
async function cancelReplacedSubscription(stripe: Stripe, subscriptionId: string, plan: Plan) {
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  // Already gone: canceled by the user, or by an earlier delivery of this event
  if (subscription.status === 'canceled' || subscription.status === 'incomplete_expired') return;
  await stripe.subscriptions.cancel(subscriptionId, {
    prorate: true,
    cancellation_details: { comment: `Upgraded to ${plan}` },
  });
}

// Never throws, like notifyOwnerOfPurchase
async function notifyOwnerOfReversal(reason: 'disputed' | 'refunded', userId: number) {
  try {
    const user = await getUserById(userId);
    if (user) await notifyOwner(reason, user.emailAddress);
  } catch (error) {
    console.error('Owner reversal notification error:', error);
  }
}

// Never throws: an error here would make Stripe retry an event already applied
async function notifyOwnerOfPurchase(plan: Plan, userId: number) {
  try {
    const user = await getUserById(userId);
    if (user) await notifyOwner(plan, user.emailAddress);
  } catch (error) {
    console.error('Owner purchase notification error:', error);
  }
}
