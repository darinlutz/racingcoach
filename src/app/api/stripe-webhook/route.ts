import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import {
  getUserById,
  renewSubscription,
  setStatusBySubscriptionId,
  startSubscription,
} from '@/lib/users';
import { ACCOUNT_STATUS, parsePlan, type Plan } from '@/lib/accountStatus';
import { notifyOwner } from '@/lib/ownerNotifications';
import { STRIPE_APP } from '@/lib/stripePlans';

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

  const stripe = new Stripe(stripeSecretKey);

  // Signature verification needs the raw, unparsed body
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      await request.text(),
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
        await notifyOwnerOfPurchase(plan, userId);
        break;
      }
      // Renewal paid: extend the subscription to the end of the period just paid for
      case 'invoice.paid': {
        const invoice = event.data.object;
        const subscription = invoice.parent?.subscription_details?.subscription;
        // The first invoice is handled by checkout.session.completed
        if (invoice.billing_reason !== 'subscription_cycle' || !subscription) break;
        const periodEnd = Math.max(0, ...invoice.lines.data.map((line) => line.period.end));
        if (!periodEnd) {
          console.warn('Renewal invoice has no billing period:', invoice.id);
          break;
        }
        await renewSubscription(
          typeof subscription === 'string' ? subscription : subscription.id,
          new Date(periodEnd * 1000).toISOString()
        );
        break;
      }
      // Subscription ended (canceled here, in the Dashboard, or after failed payments)
      case 'customer.subscription.deleted': {
        await setStatusBySubscriptionId(event.data.object.id, ACCOUNT_STATUS.canceled);
        break;
      }
      default:
        console.log('Unhandled Stripe event type:', event.type);
    }
  } catch (error) {
    // A non-2xx response makes Stripe retry the event later
    console.error('Stripe webhook handling error:', error);
    return NextResponse.json(
      { error: 'Webhook handling failed' },
      { status: 500 }
    );
  }

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

// Never throws: an error here would make Stripe retry an event already applied
async function notifyOwnerOfPurchase(plan: Plan, userId: number) {
  try {
    const user = await getUserById(userId);
    if (user) await notifyOwner(plan, user.emailAddress);
  } catch (error) {
    console.error('Owner purchase notification error:', error);
  }
}
