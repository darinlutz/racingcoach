import { NextResponse } from 'next/server';
import { forgetLabStatus, labJson, labServer, type LabPath } from '@/lib/aiLab/gatewayClient';
import { bad, labAdmin, labBody, throttled, unavailable } from '@/lib/aiLab/routeHelpers';
import { cleanParams, LAB_PARAMS, validModelName } from '@/lib/aiLab/rules';
import { audit, getAiLabSettings, saveAiLabSettings } from '@/lib/aiLab/store';

// AI Lab's Model Management (docs/AI_LAB_SETUP.md). GET: downloads in progress. POST { action, name, ... }:
//   show | remoteSize       a model's details, or a registry model's download size (before pulling)
//   load | unload           into or out of the Mac's memory (keepAlive like 30m)
//   pull                    needs confirm equal to the name; runs in the background on the Mac (one at a time)
//   cancelPull
//   delete                  needs confirm equal to the name; the Mac refuses a model production uses
//   setDefault | setParams  the playground's default model and a model's default parameters (lab settings only:
//                           production routing never reads them)
// Every change is audited. Admin role only (404); 30 actions a minute per Admin.

const GATEWAY_ACTIONS: Record<string, LabPath> = {
  show: 'POST /lab/show',
  remoteSize: 'POST /lab/remote-size',
  load: 'POST /lab/load',
  unload: 'POST /lab/unload',
  pull: 'POST /lab/pull',
  cancelPull: 'POST /lab/pull/cancel',
  delete: 'POST /lab/delete',
};
const CONFIRMED = new Set(['pull', 'delete']);
const AUDITED = new Set(['load', 'unload', 'pull', 'cancelPull', 'delete']);

export async function GET(request: Request) {
  const { denied } = await labAdmin();
  if (denied) return denied;
  try {
    const server = await labServer(new URL(request.url).searchParams.get('server'));
    const { status, body } = await labJson(server, 'GET /lab/pulls');
    return NextResponse.json(body, { status });
  } catch (error) {
    return unavailable(error);
  }
}

export async function POST(request: Request) {
  const { user, denied } = await labAdmin();
  if (denied) return denied;
  const body = await labBody(request);
  if (body instanceof NextResponse) return body;
  if (throttled(user.id, 'models', 30)) return bad('tooMany', 429);
  const action = String(body.action ?? '');
  if (action === 'setDefault' || action === 'setParams') {
    if (body.name !== null && !validModelName(body.name)) return bad('badModel');
    const settings = await getAiLabSettings();
    if (action === 'setDefault') settings.defaultModel = (body.name as string | null) ?? null;
    else if (typeof body.name === 'string') settings.modelParams[body.name] = cleanParams(body.params, LAB_PARAMS);
    const saved = await saveAiLabSettings(settings, user.id);
    await audit(user.id, { action: `models.${action}`, target: (body.name as string | null) ?? null, outcome: 'ok' });
    return NextResponse.json({ settings: saved });
  }
  const route = GATEWAY_ACTIONS[action];
  if (!route) return bad('unknownAction');
  if (!validModelName(body.name)) return bad('badModel');
  if (CONFIRMED.has(action) && body.confirm !== body.name) return bad('confirmName');
  try {
    const server = await labServer(typeof body.serverId === 'string' ? body.serverId : null);
    const keepAlive = typeof body.keepAlive === 'string' ? body.keepAlive : undefined;
    const { status, body: answer } = await labJson(server, route, { name: body.name, keepAlive }, action === 'load' ? 75_000 : 30_000);
    if (AUDITED.has(action)) {
      await audit(user.id, {
        action: `models.${action}`,
        target: body.name,
        outcome: status < 300 ? 'ok' : status === 403 || status === 409 ? 'refused' : 'failed',
        detail: status < 300 ? undefined : { status, error: answer.error ?? null },
      });
      forgetLabStatus();
    }
    return NextResponse.json(answer, { status });
  } catch (error) {
    if (AUDITED.has(action)) await audit(user.id, { action: `models.${action}`, target: body.name, outcome: 'failed', detail: { error: 'unreachable' } });
    return unavailable(error);
  }
}
