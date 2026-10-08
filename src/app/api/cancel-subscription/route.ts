import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getCurrentUser } from '@/lib/session';
import { recordCancellation } from '@/lib/users';
import { ACCOUNT_STATUS } from '@/lib/accountStatus';
import {
  CANCELLATION_REASONS,
  MAX_CANCELLATION_NOTES,
  type CancellationConfirmation,
} from '@/lib/cancellationReasons';

// Cancels the user's monthly subscription in Stripe and records why (racingcoach."CancellationReason").
// Body: { reason: one of CANCELLATION_REASONS' labels, notes?: string }
export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Log in to cancel your subscription' }, { status: 401 });
    }

    if (user.accountStatus !== ACCOUNT_STATUS.monthly || !user.stripeSubscriptionId) {
      return NextResponse.json({ error: 'No active monthly subscription to cancel' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const reason = CANCELLATION_REASONS.find((r) => r.label === body.reason);
    if (!reason) {
      return NextResponse.json({ error: 'Please choose a reason for canceling' }, { status: 400 });
    }
    const notes = typeof body.notes === 'string' ? body.notes.trim() || null : null;
    if (notes && notes.length > MAX_CANCELLATION_NOTES) {
      return NextResponse.json(
        { error: `Comments can be at most ${MAX_CANCELLATION_NOTES} characters` },
        { status: 400 }
      );
    }

    // Check if Stripe secret key is configured
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) {
      return NextResponse.json({ error: 'Stripe is not configured' }, { status: 500 });
    }

    // Cancels immediately: no further charges, no refund. SubscriptionEndDate is kept.
    // The reason and comments are also saved on the subscription in Stripe.
    const stripe = new Stripe(stripeSecretKey);
    const subscription = await stripe.subscriptions.cancel(user.stripeSubscriptionId, {
      cancellation_details: { feedback: reason.stripeFeedback, comment: notes ?? '' },
    });
    const canceledAt = new Date((subscription.canceled_at ?? Math.floor(Date.now() / 1000)) * 1000).toISOString();

    await recordCancellation(user, {
      reason: reason.label,
      notes,
      canceledAt,
      stripeSubscriptionId: subscription.id,
    });

    const confirmation: CancellationConfirmation = {
      confirmationNumber: subscription.id,
      canceledAt,
      subscriptionEndDate: user.subscriptionEndDate,
    };
    return NextResponse.json({ confirmation });
  } catch (error) {
    console.error('Stripe cancel subscription error:', error);
    return NextResponse.json({ error: 'Failed to cancel subscription' }, { status: 500 });
  }
}
