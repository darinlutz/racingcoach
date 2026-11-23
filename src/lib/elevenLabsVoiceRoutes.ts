import { NextResponse } from 'next/server';
import { ElevenLabsVoiceError } from './elevenLabsVoices';
import type { VoiceProblem } from './elevenLabsVoiceRules';
import { apiText, getDictionary } from './i18n/server';
import { isAdmin } from './roles';
import { getCurrentUser } from './session';
import type { User } from './users';

// What the Admin page's Eleven Labs Voice Management routes share: the Admin (404 for anyone else, like every Admin
// route), their language's messages, and errors in words
export type ElevenLabsVoicesText = ReturnType<typeof getDictionary>['admin']['elevenLabsVoices'];

export async function elevenLabsVoicesAdmin(): Promise<{ user: User; t: ElevenLabsVoicesText; response?: undefined } | { response: NextResponse }> {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user.role)) return { response: NextResponse.json({ error: (await apiText(user)).adminOnly }, { status: 404 }) };
  return { user, t: getDictionary(user.preferredLanguage).admin.elevenLabsVoices };
}

export const invalidVoice = (problems: VoiceProblem[], t: ElevenLabsVoicesText) =>
  NextResponse.json({ error: t.errors.invalid, problems: problems.map((p) => t.problems[p]) }, { status: 400 });

export function elevenLabsVoiceErrorResponse(error: unknown, t: ElevenLabsVoicesText, what: string): NextResponse {
  if (error instanceof ElevenLabsVoiceError) {
    const status = error.code === 'notFound' ? 404 : error.code === 'voiceNotFound' ? 400 : 409;
    return NextResponse.json({ error: t.errors[error.code], code: error.code }, { status });
  }
  console.error(`${what} error:`, error);
  return NextResponse.json({ error: t.errors.failed }, { status: 500 });
}
