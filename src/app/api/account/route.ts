import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { ACCOUNT_STATUS } from '@/lib/accountStatus';
import { apiText } from '@/lib/i18n/server';
import { notifyOwner } from '@/lib/ownerNotifications';
import { isAdmin } from '@/lib/roles';
import { deleteSession, getCurrentUser } from '@/lib/session';
import { deleteUser } from '@/lib/users';

// The Account page's Delete Account, for the signed-in user only (never an Admin). Cancels a live Stripe
// subscription first so it isn't charged again, then deletes the account and everything tied to it except
// the ActivityLog, cancellation feedback and billing history (deleteUser), and signs the browser out.
export async function DELETE() {
  const user = await getCurrentUser();
  const t = await apiText(user);
  try {
    if (!user) {
      return NextResponse.json({ error: t.logInDeleteAccount }, { status: 401 });
    }
    if (isAdmin(user.role)) {
      return NextResponse.json({ error: t.adminCannotDeleteAccount }, { status: 403 });
    }

    if (user.accountStatus === ACCOUNT_STATUS.subscribed && user.stripeSubscriptionId) {
      const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
      if (!stripeSecretKey) {
        return NextResponse.json({ error: t.notConfigured }, { status: 500 });
      }
      const stripe = new Stripe(stripeSecretKey);
      const subscription = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);
      if (subscription.status !== 'canceled') {
        await stripe.subscriptions.cancel(subscription.id, {
          cancellation_details: { comment: 'Account deleted' },
        });
      }
    }

    await deleteUser(user.id);
    await deleteSession();
    await notifyOwner('deleted', user.emailAddress);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete account error:', error);
    return NextResponse.json({ error: t.failedDeleteAccount }, { status: 500 });
  }
}
