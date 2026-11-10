import { NextResponse } from 'next/server';
import { isLocalModelId, SERVER_ID_PATTERN } from '@/lib/localAi/config';
import { localAiAdmin } from '@/lib/localAi/adminAuth';
import { MAX_TEST_PROMPT, runTestPrompt, testConnectivity, type TestRouting } from '@/lib/localAi/testConsole';
import { MeteredServicesStoppedError } from '@/lib/meteredServices';
import { BodyTooLargeError, JSON_BODY_LIMIT, readJsonLimited } from '@/lib/requestBody';

// The Admin page's Local AI Test Console (docs/local-ai.md). POST { action: 'connectivity', serverId? } checks each
// server's gateway through Cloudflare; POST { action: 'prompt', prompt, model, serverId?, routing } sends a real
// prompt through the router (routing: production, forceLocal or simulateFailure) and answers the text with every
// attempt (provider, model, tokens, time, fallback). Admin role only (404); 20 a minute per Admin, in memory.

const ROUTINGS: TestRouting[] = ['production', 'forceLocal', 'simulateFailure'];
const PER_MINUTE = 20;
const recent = new Map<number, number[]>();

function throttled(userId: number): boolean {
  const now = Date.now();
  const times = (recent.get(userId) ?? []).filter((at) => now - at < 60_000);
  if (times.length >= PER_MINUTE) return true;
  times.push(now);
  recent.set(userId, times);
  return false;
}

export async function POST(request: Request) {
  const { user, denied } = await localAiAdmin();
  if (denied) return denied;
  let body: Record<string, unknown>;
  try {
    body = (await readJsonLimited(request, JSON_BODY_LIMIT)) ?? {};
  } catch (error) {
    return NextResponse.json({ error: error instanceof BodyTooLargeError ? 'Too large' : 'Not JSON' }, { status: 400 });
  }
  if (throttled(user.id)) return NextResponse.json({ error: 'Too many tests: wait a minute' }, { status: 429 });
  const serverId = typeof body.serverId === 'string' && SERVER_ID_PATTERN.test(body.serverId) ? body.serverId : null;

  try {
    if (body.action === 'connectivity') {
      return NextResponse.json({ results: await testConnectivity(serverId) });
    }
    if (body.action === 'prompt') {
      const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
      if (!prompt || prompt.length > MAX_TEST_PROMPT) {
        return NextResponse.json({ error: `The prompt must be 1 to ${MAX_TEST_PROMPT} characters` }, { status: 400 });
      }
      if (!isLocalModelId(body.model)) return NextResponse.json({ error: 'Unknown local model' }, { status: 400 });
      const routing = ROUTINGS.includes(body.routing as TestRouting) ? (body.routing as TestRouting) : 'production';
      console.log(`Local AI test console: ${routing} prompt on ${body.model} by user ${user.id}`);
      return NextResponse.json(await runTestPrompt({ prompt, model: body.model, serverId, routing }));
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    if (error instanceof MeteredServicesStoppedError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    console.error('Local AI test console error:', error);
    // The Admin sees what failed (both attempts' details are in AI Inference Monitoring)
    return NextResponse.json({ error: error instanceof Error ? error.message.slice(0, 300) : 'Test failed' }, { status: 502 });
  }
}
