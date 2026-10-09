import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import {
  getUserById,
  grantLifetimeAccess,
  renewSubscription,
  setStatusBySubscriptionId,
  startSubscription,
} from '@/lib/users';
import { ACCOUNT_STATUS } from '@/lib/accountStatus';
import { notifyOwner, type OwnerEvent } from '@/lib/ownerNotifications';
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
      // First payment: start a one-month Monthly Subscription, or a Lifetime Subscription
      case 'checkout.session.completed':
      // Delayed payment methods (e.g. bank debits) confirm Lifetime payments here
      case 'checkout.session.async_payment_succeeded': {
        const session = event.data.object;
        // Another app's session on the shared Stripe account: its user IDs aren't ours
        if (session.metadata?.app !== STRIPE_APP) {
          console.log('Ignoring Checkout Session from another app:', session.id);
          break;
        }
        const userId = Number(session.client_reference_id);
        if (session.mode === 'payment') {
          if (session.metadata?.plan !== 'lifetime' || !Number.isInteger(userId)) {
            console.warn('Payment session not linked to a Lifetime purchase:', session.id);
            break;
          }
          // A delayed payment completes the session before the money arrives
          if (session.payment_status !== 'paid') break;
          const previousSubscriptionId = await grantLifetimeAccess(
            userId,
            typeof session.customer === 'string' ? session.customer : null
          );
          // A monthly subscriber upgraded: stop charging them monthly
          if (previousSubscriptionId) {
            try {
              await stripe.subscriptions.cancel(previousSubscriptionId);
            } catch (error) {
              // e.g. it was already canceled; the account is Lifetime either way
              console.error('Failed to cancel monthly subscription after Lifetime purchase:', error);
            }
          }
          await notifyOwnerOfPurchase('lifetime', userId);
          break;
        }
        if (event.type !== 'checkout.session.completed') break;
        if (
          session.mode !== 'subscription' ||
          !Number.isInteger(userId) ||
          typeof session.customer !== 'string' ||
          typeof session.subscription !== 'string'
        ) {
          console.warn('Checkout session not linked to a user:', session.id);
          break;
        }
        // Subscription mode sessions only complete once the first payment succeeds
        await startSubscription(userId, session.customer, session.subscription);
        await notifyOwnerOfPurchase('monthly', userId);
        break;
      }
      // Monthly renewal paid: extend the subscription another month
      case 'invoice.paid': {
        const invoice = event.data.object;
        const subscription = invoice.parent?.subscription_details?.subscription;
        // The first invoice is handled by checkout.session.completed
        if (invoice.billing_reason !== 'subscription_cycle' || !subscription) break;
        await renewSubscription(
          typeof subscription === 'string' ? subscription : subscription.id
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

// Never throws: an error here would make Stripe retry an event already applied
async function notifyOwnerOfPurchase(plan: Extract<OwnerEvent, 'monthly' | 'lifetime'>, userId: number) {
  try {
    const user = await getUserById(userId);
    if (user) await notifyOwner(plan, user.emailAddress);
  } catch (error) {
    console.error('Owner purchase notification error:', error);
  }
}
