// The emails data subject rights send through Resend (like passwordReset's and supportRequest.ts's): the link that
// verifies a request from someone who isn't signed in, the code that re-authenticates an account without a password,
// and notices to the requester and to the site owner. English, like the legal documents; they hold no personal data
// beyond the request's reference, and never a link that works without signing in except the one-time verification.
import { requestReference, type RequestType } from './privacyRules';
import { OWNER_EMAIL } from './users';

const TYPE_TEXT: Record<RequestType, string> = {
  access: 'access to your personal data',
  portability: 'a portable copy of your personal data',
  rectification: 'correction of your personal data',
  erasure: 'deletion of some of your personal data',
  account_deletion: 'deletion of your account',
  restriction: 'restriction of processing',
  objection: 'an objection to processing',
  other: 'a privacy request',
};

async function send(to: string, subject: string, text: string): Promise<void> {
  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) throw new Error('Resend API key not configured');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendApiKey}` },
    body: JSON.stringify({ from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev', to, subject, text }),
  });
  if (!response.ok) {
    // The status only: Resend's error body can echo the address
    throw new Error(`Resend API error: ${response.status}`);
  }
}

export async function sendVerificationEmail(to: string, input: { requestId: string; type: RequestType; link: string }): Promise<void> {
  await send(
    to,
    `Confirm your RacingCoach.app privacy request ${requestReference(input.requestId)}`,
    [
      `We received a request for ${TYPE_TEXT[input.type]} made with this email address.`,
      '',
      'To confirm it was you, open this link within 24 hours:',
      input.link,
      '',
      'If you did not make this request, ignore this email and nothing will happen.',
      '',
      'RacingCoach.app, operated by Clarivex, LLC. support@racingcoach.app',
    ].join('\n')
  );
}

export async function sendReauthCode(to: string, code: string): Promise<void> {
  await send(
    to,
    'Your RacingCoach.app confirmation code',
    [
      `Your confirmation code is ${code}`,
      '',
      'Enter it on the Privacy & Data Rights page within 15 minutes to confirm it’s you before downloading or deleting data.',
      'If you did not ask for it, someone may be signed in to your account: change your password.',
    ].join('\n')
  );
}

// To the requester when their request is received, extended, completed or refused. The details are on the Privacy &
// Data Rights page for account holders; someone without an account gets the outcome here.
export async function sendRequestUpdate(
  to: string,
  input: { requestId: string; type: RequestType; headline: string; message: string | null; signedIn: boolean }
): Promise<void> {
  await send(
    to,
    `RacingCoach.app privacy request ${requestReference(input.requestId)}: ${input.headline}`,
    [
      `Your request for ${TYPE_TEXT[input.type]} (${requestReference(input.requestId)}): ${input.headline}.`,
      ...(input.message ? ['', input.message] : []),
      '',
      input.signedIn
        ? 'See its history under My Settings > Privacy & Data Rights.'
        : 'Reply to support@racingcoach.app with any questions.',
      '',
      'If you are not satisfied with how we handled it, you can complain to the data protection supervisory authority where you live or work.',
    ].join('\n')
  );
}

// To the site owner, so a request needing an Admin isn't missed
export async function notifyOwnerOfRequest(input: { requestId: string; type: RequestType; review: boolean }): Promise<void> {
  await send(
    OWNER_EMAIL,
    `PRIVACY REQUEST ${requestReference(input.requestId)}: ${input.type}${input.review ? ' (needs review)' : ''}`,
    `A privacy request was received: ${TYPE_TEXT[input.type]}.\nOpen Admin > Privacy Requests to handle it. It is due in one month.`
  );
}

// Emails are best effort: a request is recorded whether or not they go out, and the page shows its status
export async function quietly(work: Promise<void>, what: string): Promise<void> {
  try {
    await work;
  } catch (error) {
    console.error(`Privacy email failed (${what}):`, error instanceof Error ? error.message : error);
  }
}
