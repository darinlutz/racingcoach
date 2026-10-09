import { OWNER_EMAIL } from './users';

// Emails the site owner when a user signs up, buys a plan, or cancels.
const APP_NAME = 'RacingCoach';

export type OwnerEvent = 'signup' | 'monthly' | 'lifetime' | 'canceled';

const EVENTS: Record<OwnerEvent, { subject: string; action: string }> = {
  signup: { subject: 'New user sign up', action: 'signed up' },
  monthly: { subject: 'New monthly subscription', action: 'purchased a monthly subscription' },
  lifetime: { subject: 'New lifetime subscription', action: 'purchased a lifetime subscription' },
  canceled: { subject: 'Subscription canceled', action: 'canceled their monthly subscription' },
};

// Never throws: a failed notification is logged and shouldn't fail the
// signup, payment or cancellation that triggered it.
export async function notifyOwner(event: OwnerEvent, userEmail: string): Promise<void> {
  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    console.error('Resend API key not configured. Owner notification skipped:', event);
    return;
  }

  const { subject, action } = EVENTS[event];
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
