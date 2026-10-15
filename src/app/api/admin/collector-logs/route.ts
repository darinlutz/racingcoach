import { NextResponse } from 'next/server';
import { readCollectorLogs } from '@/lib/collectorLogs';
import { apiText } from '@/lib/i18n/server';
import { isAdmin } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The Admin page's Collector Logs section: GET ?userId=<id>&runId=<uuid> (both optional) answers the users with
// collector logs, their runs, the run's lines (or the newest lines without a run) and the log review agent's
// problems (src/lib/collectorLogs.ts). Admin role only; anyone else gets a 404, like the Admin page.
export async function GET(request: Request) {
  const user = await getCurrentUser();
  const t = await apiText(user);
  try {
    if (!user || !isAdmin(user.role)) {
      return NextResponse.json({ error: t.adminOnly }, { status: 404 });
    }
    const params = new URL(request.url).searchParams;
    const userParam = params.get('userId');
    const runParam = params.get('runId');
    const userId = userParam ? Number(userParam) : null;
    if (userId !== null && (!Number.isInteger(userId) || userId <= 0)) {
      return NextResponse.json({ error: t.userNotFound }, { status: 400 });
    }
    if (runParam && !UUID.test(runParam)) {
      return NextResponse.json({ error: 'runId must be a UUID' }, { status: 400 });
    }
    return NextResponse.json(await readCollectorLogs(userId, runParam || null));
  } catch (error) {
    console.error('Admin collector logs error:', error);
    return NextResponse.json({ error: 'Failed to load the collector logs' }, { status: 500 });
  }
}
