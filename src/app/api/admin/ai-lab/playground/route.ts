import { NextResponse } from 'next/server';
import { isAiModel } from '@/lib/aiModels';
import { runPlayground, type PlaygroundTarget } from '@/lib/aiLab/playground';
import { bad, labAdmin, labBody, throttled } from '@/lib/aiLab/routeHelpers';
import { LAB_TEXT_LIMITS, validModelName } from '@/lib/aiLab/rules';
import { audit } from '@/lib/aiLab/store';
import { SERVER_ID_PATTERN } from '@/lib/localAi/config';

// AI Lab's Model Playground (docs/AI_LAB_SETUP.md). POST { target: { provider: 'Local' | 'Cloud', model, serverId? },
// system, prompt, params } answers NDJSON: { type: 'token' | 'thinking', text } as the model writes, then
// { type: 'done', metrics } or { type: 'error', error, detail }. The page asks once per model, so side-by-side runs
// are separate requests, each measured on its own. Streaming off on the page only changes when the text is shown.
// Admin role only (404); 30 runs a minute and 4 at once per Admin. Cloud runs are audited (they cost money).

const RUNNING = new Map<number, number>();
const MAX_AT_ONCE = 4;

export async function POST(request: Request) {
  const { user, denied } = await labAdmin();
  if (denied) return denied;
  const body = await labBody(request);
  if (body instanceof NextResponse) return body;
  if (throttled(user.id, 'playground', 30)) return bad('tooMany', 429);

  const t = (body.target ?? {}) as Record<string, unknown>;
  let target: PlaygroundTarget;
  if (t.provider === 'Local' && validModelName(t.model)) {
    target = { provider: 'Local', model: t.model, serverId: typeof t.serverId === 'string' && SERVER_ID_PATTERN.test(t.serverId) ? t.serverId : null };
  } else if (t.provider === 'Cloud' && isAiModel(t.model)) {
    target = { provider: 'Cloud', model: t.model };
  } else {
    return bad('badModel');
  }
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  const system = typeof body.system === 'string' ? body.system.trim() : '';
  if (!prompt || prompt.length > LAB_TEXT_LIMITS.prompt || system.length > LAB_TEXT_LIMITS.system) return bad('badPrompt');
  if ((RUNNING.get(user.id) ?? 0) >= MAX_AT_ONCE) return bad('tooManyAtOnce', 429);
  RUNNING.set(user.id, (RUNNING.get(user.id) ?? 0) + 1);

  if (target.provider === 'Cloud') await audit(user.id, { action: 'playground.cloudRun', target: target.model, outcome: 'ok' });
  const events = runPlayground({ target, system, prompt, params: body.params, signal: request.signal });
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await events.next();
        if (next.done) {
          controller.close();
          RUNNING.set(user.id, Math.max(0, (RUNNING.get(user.id) ?? 1) - 1));
          return;
        }
        controller.enqueue(encoder.encode(`${JSON.stringify(next.value)}\n`));
      } catch (error) {
        controller.error(error);
        RUNNING.set(user.id, Math.max(0, (RUNNING.get(user.id) ?? 1) - 1));
      }
    },
    cancel() {
      RUNNING.set(user.id, Math.max(0, (RUNNING.get(user.id) ?? 1) - 1));
    },
  });
  return new Response(stream, { headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store, no-transform', 'x-accel-buffering': 'no' } });
}
