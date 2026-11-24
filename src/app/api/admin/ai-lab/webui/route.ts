import { NextResponse } from 'next/server';
import { labJson, labServer, type LabPath } from '@/lib/aiLab/gatewayClient';
import { bad, labAdmin, labBody, throttled, unavailable } from '@/lib/aiLab/routeHelpers';
import { audit } from '@/lib/aiLab/store';

// AI Lab's Memory, Knowledge and Model Configuration tabs (docs/AI_LAB_SETUP.md): Open WebUI's own memories,
// knowledge bases and workspace models, reached through the Mac's gateway, which holds the Open WebUI API key and
// rebuilds each request from checked fields. POST { action, ... } with one of the actions below. Nothing here reads
// or sends production data: what's in Open WebUI is only what the Admin puts there. Changes are audited.
// Admin role only (404); 60 a minute per Admin.

const ACTIONS: Record<string, { route: LabPath; audited: boolean }> = {
  'memories.list': { route: 'GET /lab/webui/memories', audited: false },
  'memories.add': { route: 'POST /lab/webui/memories', audited: true },
  'memories.update': { route: 'POST /lab/webui/memories/update', audited: true },
  'memories.delete': { route: 'POST /lab/webui/memories/delete', audited: true },
  'memories.query': { route: 'POST /lab/webui/memories/query', audited: false },
  'knowledge.list': { route: 'GET /lab/webui/knowledge', audited: false },
  'knowledge.create': { route: 'POST /lab/webui/knowledge', audited: true },
  'models.list': { route: 'GET /lab/webui/models', audited: false },
  'models.create': { route: 'POST /lab/webui/models', audited: true },
};

export async function POST(request: Request) {
  const { user, denied } = await labAdmin();
  if (denied) return denied;
  const body = await labBody(request);
  if (body instanceof NextResponse) return body;
  if (throttled(user.id, 'webui', 60)) return bad('tooMany', 429);
  const { action, serverId, ...rest } = body;
  const entry = ACTIONS[String(action)];
  if (!entry) return bad('unknownAction');
  try {
    const server = await labServer(typeof serverId === 'string' ? serverId : null);
    const { status, body: answer } = await labJson(server, entry.route, entry.route.startsWith('POST') ? rest : undefined);
    if (entry.audited) {
      const target = typeof rest.id === 'string' ? rest.id : typeof rest.name === 'string' ? rest.name : null;
      await audit(user.id, { action: `webui.${action}`, target, outcome: status < 300 ? 'ok' : 'failed', detail: status < 300 ? undefined : { status, error: answer.error ?? null } });
    }
    return NextResponse.json(answer, { status });
  } catch (error) {
    return unavailable(error);
  }
}
