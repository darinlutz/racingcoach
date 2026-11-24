import { NextResponse } from 'next/server';
import { labHistory, labStatus } from '@/lib/aiLab/gatewayClient';
import { labAdmin, throttled, unavailable } from '@/lib/aiLab/routeHelpers';
import { getAiLabSettings, labCloudSpendTodayUsd, readAudit } from '@/lib/aiLab/store';
import { readInferenceReport } from '@/lib/localAi/report';
import { readLocalAiStatus } from '@/lib/localAi/report';

// AI Lab's Overview (docs/AI_LAB_SETUP.md): the Mac's gateway (/lab/status: Ollama, models, Open WebUI), the
// production heartbeat and server registration (Local AI Server Mode), the last 24 hours' inference counts from
// "AiInferenceEvents", the lab's cloud spend today and settings, and the latest audit entries. ?fresh=1 asks the
// Mac again now (Refresh Status, Test Connection), limited to 12 a minute; otherwise the status is a few seconds old
// at most, and an unreachable Mac is asked again only every 15 s. Admin role only (404).

export async function GET(request: Request) {
  const { user, denied } = await labAdmin();
  if (denied) return denied;
  const url = new URL(request.url);
  const serverId = url.searchParams.get('server');
  const fresh = url.searchParams.get('fresh') === '1' && !throttled(user.id, 'status', 12);
  try {
    const [lab, production, report, settings, spentToday, auditLog] = await Promise.all([
      labStatus(serverId, fresh),
      readLocalAiStatus(),
      readInferenceReport({ range: '24h', timeZone: 'UTC', provider: null, model: null, feature: null }),
      getAiLabSettings(),
      labCloudSpendTodayUsd(),
      readAudit(25),
    ]);
    return NextResponse.json({
      lab,
      history: labHistory(),
      production: { configured: production.configured, mode: production.settings.mode, servers: production.servers, heartbeatStaleMs: production.heartbeatStaleMs },
      inference24h: report.totals,
      settings,
      spentTodayUsd: spentToday,
      audit: auditLog,
      now: new Date().toISOString(),
    });
  } catch (error) {
    return unavailable(error);
  }
}
