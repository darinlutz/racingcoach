import { PLANS, type Plan } from './accountStatus';
import { OWNER_EMAIL } from './users';

// Emails the site owner when a user signs up, buys a plan, cancels, or deletes their account.
const APP_NAME = 'RacingCoach';

export type OwnerEvent = 'signup' | Plan | 'canceled' | 'deleted';

function describe(event: OwnerEvent): { subject: string; action: string } {
  switch (event) {
    case 'signup':
      return { subject: 'New user sign up', action: 'signed up' };
    case 'canceled':
      return { subject: 'Subscription canceled', action: 'canceled their subscription' };
    case 'deleted':
      return { subject: 'Account deleted', action: 'deleted their account' };
    default: {
      // e.g. "Gold annual"
      const { level, period } = PLANS[event];
      return {
        subject: `New ${level} ${period} subscription`,
        action: `purchased a ${level} ${period} subscription`,
      };
    }
  }
}

// Never throws: a failed notification is logged and shouldn't fail the
// signup, payment or cancellation that triggered it.
export async function notifyOwner(event: OwnerEvent, userEmail: string): Promise<void> {
  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    console.error('Resend API key not configured. Owner notification skipped:', event);
    return;
  }

  const { subject, action } = describe(event);
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${resendApiKey}`,
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
        to: OWNER_EMAIL,
        subject: `${APP_NAME} app ${subject}`,
        text: `User ${userEmail} has just ${action} for ${APP_NAME}.`,
      }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      console.error('Resend API error (owner notification):', error);
    }
  } catch (error) {
    console.error('Owner notification error:', error);
  }
}
