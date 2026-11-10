import { NextResponse } from 'next/server';
import { z } from 'zod';
import { SERVER_ID_PATTERN } from '@/lib/localAi/config';
import { localAiSecret } from '@/lib/localAi/localModel';
import { verifyRequest } from '@/lib/localAi/signing';
import { heartbeatNonces, recordHeartbeat } from '@/lib/localAi/state';
import { getLocalAiSettings, listLocalAiServers, persistHeartbeat } from '@/lib/localAi/store';
import { BodyTooLargeError, readTextLimited } from '@/lib/requestBody';

// A local AI server's heartbeat (docs/local-ai.md), sent every 10 s by local-ai/gateway.ts on the Mac. No sign-in:
// the request must be signed with LOCAL_AI_SHARED_SECRET (src/lib/localAi/signing.ts: a timestamp within 60 s of
// this server's clock and a nonce not seen before, so it can't be replayed) and name a server an Admin registered
// and enabled on the Admin page, so nobody can add a server or speak for one. Availability is judged by when it
// arrived here, never the Mac's clock. Answers the Admin page's mode so the Mac's log can show it.

const MAX_BODY = 16 * 1024;

const modelList = z.array(z.string().min(1).max(100)).max(100);

const heartbeatSchema = z.object({
  serverId: z.string().regex(SERVER_ID_PATTERN),
  sentAt: z.number().int().nonnegative(),
  agentVersion: z.string().max(40),
  runtime: z.enum(['ok', 'down']),
  installedModels: modelList,
  loadedModels: modelList,
  activeRequests: z.number().int().min(0).max(1000),
  maxConcurrency: z.number().int().min(0).max(64),
  queueDepth: z.number().int().min(0).max(1000),
  freeMemoryBytes: z.number().nonnegative().nullable(),
  totalMemoryBytes: z.number().nonnegative().nullable(),
  accepting: z.boolean(),
  developmentMode: z.boolean(),
});

// Refusals are logged at most once a minute each, so a misconfigured Mac can't fill the log
const lastLogged = new Map<string, number>();
function logRefusal(reason: string) {
  const now = Date.now();
  if (now - (lastLogged.get(reason) ?? 0) < 60_000) return;
  lastLogged.set(reason, now);
  console.warn(`Local AI heartbeat refused: ${reason}`);
}

export async function POST(request: Request) {
  const secret = localAiSecret();
  if (!secret) {
    logRefusal('LOCAL_AI_SHARED_SECRET is not configured');
    return NextResponse.json({ error: 'Local AI is not configured' }, { status: 503 });
  }
  let body: string;
  try {
    body = await readTextLimited(request, MAX_BODY);
  } catch (error) {
    if (error instanceof BodyTooLargeError) return NextResponse.json({ error: 'Too large' }, { status: 413 });
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }

  const path = new URL(request.url).pathname;
  const verdict = verifyRequest(secret, 'heartbeat', { method: 'POST', path, body }, request.headers, heartbeatNonces());
  if (!verdict.ok) {
    logRefusal(`signature ${verdict.reason}`);
    return NextResponse.json({ error: 'Unauthorized', reason: verdict.reason }, { status: 401 });
  }

  let parsed: z.infer<typeof heartbeatSchema>;
  try {
    parsed = heartbeatSchema.parse(JSON.parse(body));
  } catch {
    logRefusal('malformed body');
    return NextResponse.json({ error: 'Bad heartbeat' }, { status: 400 });
  }

  try {
    const server = (await listLocalAiServers()).find((s) => s.id === parsed.serverId);
    if (!server || !server.enabled) {
      logRefusal(`server ${parsed.serverId} is not registered and enabled`);
      return NextResponse.json({ error: 'Server not registered' }, { status: 403 });
    }
    recordHeartbeat(parsed);
    void persistHeartbeat(parsed);
    const settings = await getLocalAiSettings();
    return NextResponse.json({ ok: true, mode: settings.mode, serverTime: Date.now() });
  } catch (error) {
    console.error('Local AI heartbeat error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
