import { NextResponse } from 'next/server';
import { apiText } from '@/lib/i18n/server';
import { readUsageReport, USAGE_RANGES, type UsageRange } from '@/lib/rateLimits';
import { isAdmin } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';

// The Rate Limiting section's AI usage report: GET ?range=hour|day|week|month|all&by=user|ip&q=<name, email or IP>
// (src/lib/rateLimits.ts readUsageReport). Admin role only; anyone else gets a 404.
export async function GET(request: Request) {
  const user = await getCurrentUser();
  const t = await apiText(user);
  try {
    if (!user || !isAdmin(user.role)) {
      return NextResponse.json({ error: t.adminOnly }, { status: 404 });
    }
    const params = new URL(request.url).searchParams;
    const rangeParam = params.get('range') ?? '';
    const range: UsageRange = (USAGE_RANGES as readonly string[]).includes(rangeParam) ? (rangeParam as UsageRange) : 'day';
    const by = params.get('by') === 'ip' ? 'ip' : 'user';
    const search = (params.get('q') ?? '').slice(0, 200);
    return NextResponse.json(await readUsageReport(range, by, search));
  } catch (error) {
    console.error('AI usage report error:', error);
    return NextResponse.json({ error: t.failedLoadUsage }, { status: 500 });
  }
}
