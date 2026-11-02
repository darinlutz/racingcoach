import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { ACCOUNT_STATUS } from '@/lib/accountStatus';
import { deleteAccount } from '@/lib/dataErasure';
import { apiText, getDictionary } from '@/lib/i18n/server';
import { notifyOwner } from '@/lib/ownerNotifications';
import { quietly, sendRequestUpdate } from '@/lib/privacyEmail';
import { isRecentlyReauthenticated, reauthenticateWithCode, reauthenticateWithPassword } from '@/lib/reauth';
import { isAdmin } from '@/lib/roles';
import { deleteSession, getCurrentUser } from '@/lib/session';

// Delete My Account (My Settings and Privacy & Data Rights), for the signed-in user only (never an Admin). Body:
// { confirm: 'DELETE', password? | code? }: the user types DELETE and confirms it's them (their password, or an emailed
// code for an account without one), unless this sign-in already did within 10 minutes. Cancels a live Stripe
// subscription first so it isn't charged again, then deletes the account and everything tied to it except cancellation
// feedback and billing history (unlinked) and the ActivityLog (anonymized), recording it as a completed privacy request and in the
// erasure ledger (deleteAccount in src/lib/dataErasure.ts), and signs the browser out.
export async function DELETE(request: Request) {
  const user = await getCurrentUser();
  const t = await apiText(user);
  try {
    if (!user) {
      return NextResponse.json({ error: t.logInDeleteAccount }, { status: 401 });
    }
    if (isAdmin(user.role)) {
      return NextResponse.json({ error: t.adminCannotDeleteAccount }, { status: 403 });
    }
    const p = getDictionary(user.preferredLanguage).privacyRights;
    const body = await request.json().catch(() => ({}));
    if (body.confirm !== 'DELETE') {
      return NextResponse.json({ error: p.errors.confirmDelete }, { status: 400 });
    }
    if (!(await isRecentlyReauthenticated(user))) {
      const result =
        typeof body.password === 'string' && body.password
          ? await reauthenticateWithPassword(user, body.password)
          : typeof body.code === 'string' && body.code
            ? await reauthenticateWithCode(user, body.code.trim())
            : null;
      if (result !== 'ok') {
        return NextResponse.json(
          { error: result ? p.reauth[result] : p.reauth.required, reauthRequired: true },
          { status: result === 'tooMany' ? 429 : 403 }
        );
      }
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

    const done = await deleteAccount(user);
    await deleteSession();
    await notifyOwner('deleted', user.emailAddress);
    await quietly(
      sendRequestUpdate(user.emailAddress, {
        requestId: done.id,
        type: 'account_deletion',
        headline: 'completed',
        message: `${done.resolution} Billing records we must keep for tax, records of your cookie choices and the record of this request are kept without your name and email address.`,
        signedIn: false,
      }),
      'account deleted'
    );
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete account error:', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: t.failedDeleteAccount }, { status: 500 });
  }
}
