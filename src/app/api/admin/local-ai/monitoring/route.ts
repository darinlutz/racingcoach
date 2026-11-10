import { NextResponse } from 'next/server';
import { localAiAdmin } from '@/lib/localAi/adminAuth';
import { parseMonitoringFilters, readInferenceReport, readLocalAiStatus } from '@/lib/localAi/report';

// The Admin page's AI Inference Monitoring (docs/local-ai.md): ?range=today|24h|7d|30d|all&tz=&provider=&model=&feature=
// answers the counts by model and feature, the 50 latest attempts (never prompts, answers or users) and the local
// servers' live status. Admin role only (404).
export async function GET(request: Request) {
  const { denied } = await localAiAdmin();
  if (denied) return denied;
  try {
    const filters = parseMonitoringFilters(new URL(request.url).searchParams);
    const [report, status] = await Promise.all([readInferenceReport(filters), readLocalAiStatus()]);
    return NextResponse.json({ filters, report, status }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('AI inference monitoring error:', error);
    return NextResponse.json({ error: 'Failed to read the statistics' }, { status: 500 });
  }
}
