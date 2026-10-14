import { OWNER_EMAIL } from './users';

// The Support page's reports, emailed to the site owner through Resend.
export const MAX_SUPPORT_DESCRIPTION = 5000;
const SUBJECT = 'RACINGCOACH Support - Issue';

// Throws when Resend isn't configured or refuses the email. Replying to the email answers the user.
export async function sendSupportRequest(input: { name: string; email: string; description: string }): Promise<void> {
  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    throw new Error('Resend API key not configured');
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${resendApiKey}`,
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
      to: OWNER_EMAIL,
      reply_to: input.email,
      subject: SUBJECT,
      text: `${input.description}\n\n---\nFrom: ${input.name} <${input.email}>`,
    }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(`Resend API error: ${JSON.stringify(error)}`);
  }
}
