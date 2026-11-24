import { NextResponse } from 'next/server';
import { localAiAdmin } from '@/lib/localAi/adminAuth';
import { BodyTooLargeError, JSON_BODY_LIMIT, readJsonLimited } from '@/lib/requestBody';
import { LabUnavailableError } from './gatewayClient';

// What every /api/admin/ai-lab route shares (docs/AI_LAB_SETUP.md): the Admin role, checked on the server for every
// request (anyone else gets a 404, like the Admin page), a size-capped JSON body, a per-Admin rate limit in memory,
// and how a failure reaching the Mac is answered.

export const labAdmin = localAiAdmin;

export const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function labBody(request: Request): Promise<Record<string, unknown> | NextResponse> {
  try {
    return (await readJsonLimited(request, JSON_BODY_LIMIT)) ?? {};
  } catch (error) {
    return bad(error instanceof BodyTooLargeError ? 'tooLarge' : 'notJson');
  }
}

const recent = new Map<string, number[]>();

// true when the Admin has made perMinute requests of this kind in the last minute
export function throttled(userId: number, kind: string, perMinute: number): boolean {
  const key = `${kind}:${userId}`;
  const now = Date.now();
  const times = (recent.get(key) ?? []).filter((at) => now - at < 60_000);
  if (times.length >= perMinute) return true;
  times.push(now);
  recent.set(key, times);
  return false;
}

export function unavailable(error: unknown): NextResponse {
  if (error instanceof LabUnavailableError) {
    return NextResponse.json({ error: error.reason, detail: error.message }, { status: error.reason === 'unreachable' ? 502 : 503 });
  }
  console.error('AI Lab error:', error);
  return NextResponse.json({ error: 'failed' }, { status: 500 });
}
