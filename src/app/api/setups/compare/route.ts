import { NextResponse } from 'next/server';
import { compareSetups } from '@/lib/setupCompare';
import { idOf, setupErrorResponse, setupsSession } from '@/lib/setupRoutes';
import { readLinkedLaps, readRevision } from '@/lib/setups';

// Two of the signed-in user's setup revisions side by side (?a=<baseline revision>&b=<comparison revision>):
// every parameter by its path (setupCompare.ts), and the laps driven on each when they're captures
export async function GET(request: Request) {
  const session = await setupsSession();
  if (session.response) return session.response;
  const url = new URL(request.url);
  const a = idOf(url.searchParams.get('a'));
  const b = idOf(url.searchParams.get('b'));
  if (!a || !b) return NextResponse.json({ error: session.t.invalid }, { status: 400 });
  try {
    const [baseline, comparison] = await Promise.all([readRevision(session.user.id, a), readRevision(session.user.id, b)]);
    if (!baseline || !comparison) return NextResponse.json({ error: session.t.notFound }, { status: 404 });
    const result = compareSetups(
      { car: baseline.setup.car, carKey: baseline.setup.carKey, parameters: baseline.parameters },
      { car: comparison.setup.car, carKey: comparison.setup.carKey, parameters: comparison.parameters }
    );
    const [baselineLaps, comparisonLaps] = await Promise.all([readLinkedLaps(session.user.id, a), readLinkedLaps(session.user.id, b)]);
    const strip = (laps: Awaited<ReturnType<typeof readLinkedLaps>>) => laps && { ...laps, clientLapIds: undefined };
    return NextResponse.json({
      baseline: { ...baseline, parameters: undefined, valueCount: baseline.parameters.length },
      comparison: { ...comparison, parameters: undefined, valueCount: comparison.parameters.length },
      result,
      laps: { baseline: strip(baselineLaps), comparison: strip(comparisonLaps) },
    });
  } catch (error) {
    return setupErrorResponse(error, session.t, 'Setup compare');
  }
}
