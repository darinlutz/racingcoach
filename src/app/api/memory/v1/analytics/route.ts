import { NextResponse } from 'next/server';
import { memoryRoute, namespacesFor, searchParams } from '@/lib/memory/api';
import { analytics, storageEstimate } from '@/lib/memory/analytics';
import { serialize } from '@/lib/memory/portable';

// Analytics for a date range (default the last 30 days) and namespaces; ?format=csv exports the daily series
export const GET = memoryRoute({ scope: 'memory:admin' }, async (request, caller) => {
  const sp = searchParams(request);
  const to = sp.str('to', 40) && !Number.isNaN(Date.parse(sp.str('to', 40)!)) ? new Date(sp.str('to', 40)!) : new Date();
  const from = sp.str('from', 40) && !Number.isNaN(Date.parse(sp.str('from', 40)!)) ? new Date(sp.str('from', 40)!) : new Date(to.getTime() - 30 * 86_400_000);
  if (to.getTime() - from.getTime() > 400 * 86_400_000) from.setTime(to.getTime() - 400 * 86_400_000);
  const ns = sp.list('namespace').length ? (await namespacesFor(caller, sp.list('namespace'))).map((n) => n.id) : null;
  const data = await analytics({ from: from.toISOString(), to: to.toISOString(), namespaceIds: ns });
  if (sp.str('format') === 'csv') {
    const rows = data.growth.map((g, i) => ({ day: g.day, created: g.created, deleted: g.deleted, total: g.total, retrievals: data.retrieval.series[i]?.requests ?? 0, emptyRetrievals: data.retrieval.series[i]?.empty ?? 0, avgLatencyMs: data.retrieval.series[i]?.avg_ms ?? null, avgTokens: data.retrieval.series[i]?.avg_tokens ?? null }));
    return new NextResponse(serialize('csv', rows, {}), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="memory-analytics-${from.toISOString().slice(0, 10)}-${to.toISOString().slice(0, 10)}.csv"` } });
  }
  return { ...data, storageEstimate: await storageEstimate() };
});
