import { NextResponse } from 'next/server';
import { aiErrorResponse } from '@/lib/aiErrors';
import { weatherContextFromLive } from '@/lib/engineering/weatherContext';
import { getDictionary } from '@/lib/i18n/server';
import { readEngineerSnapshot } from '@/lib/liveRacing';
import { aiRateLimit, type AiRateLimit } from '@/lib/rateLimits';
import { readJsonLimited } from '@/lib/requestBody';
import { canUseInCarCoach } from '@/lib/roles';
import { compareSetups } from '@/lib/setupCompare';
import { measureSessionRotation, setupWorkbenchAnswer } from '@/lib/setupEngineer';
import { idOf, setupErrorResponse, setupsSession } from '@/lib/setupRoutes';
import { readLinkedLaps, readRevision, readSetup, saveProposal } from '@/lib/setups';
import { getEnableAiFeatures } from '@/lib/siteSettings';

// The Setups page's Setup Engineer (setupEngineer.ts's setupWorkbenchAnswer): { revisionId, compareRevisionId?,
// question }. Reads the revision's values, the comparison's differences, the laps driven on it and their understeer and
// oversteer, and, when the driver is in that car in iRacing right now, the track conditions. Answers the analysis and
// the proposed changes, saved as pending (racingcoach."SetupProposals") until the driver accepts or rejects them
// (/api/setups/proposals/[id]). Silver and Gold members and Admins only, like the radio's Setup Engineer, and rate
// limited as setupEngineer, before any AI call.
export const maxDuration = 60;

const MAX_QUESTION = 1000;

export async function POST(request: Request) {
  const session = await setupsSession();
  if (session.response) return session.response;
  const { user, t } = session;
  let limit: AiRateLimit | null = null;
  try {
    if (!(await getEnableAiFeatures())) return NextResponse.json({ error: t.engineerFailed, code: 'aiFeaturesDisabled' }, { status: 403 });
    const body = await readJsonLimited(request, 16 * 1024).catch(() => null);
    const revisionId = idOf(String(body?.revisionId ?? ''));
    const compareId = body?.compareRevisionId == null ? null : idOf(String(body.compareRevisionId));
    const question = typeof body?.question === 'string' ? body.question.trim().slice(0, MAX_QUESTION) : '';
    if (!revisionId) return NextResponse.json({ error: t.invalid }, { status: 400 });
    if (!question) return NextResponse.json({ error: t.questionMissing }, { status: 400 });
    if (!canUseInCarCoach(user)) {
      return NextResponse.json({ error: getDictionary(user.preferredLanguage).setups.engineer.membersOnly, code: 'membershipRequired' }, { status: 403 });
    }
    const revision = await readRevision(user.id, revisionId);
    if (!revision) return NextResponse.json({ error: t.notFound }, { status: 404 });
    if (!revision.parameters.length) return NextResponse.json({ error: t.noValues, code: 'noValues' }, { status: 400 });
    const other = compareId ? await readRevision(user.id, compareId) : null;
    if (compareId && !other) return NextResponse.json({ error: t.notFound }, { status: 404 });
    let comparison = null;
    if (other) {
      const result = compareSetups(
        { car: revision.setup.car, carKey: revision.setup.carKey, parameters: revision.parameters },
        { car: other.setup.car, carKey: other.setup.carKey, parameters: other.parameters }
      );
      if (!result.compatible) return NextResponse.json({ error: t.incompatible, code: 'incompatible' }, { status: 400 });
      comparison = { name: `${other.setup.name} (rev ${other.number})`, rows: result.rows };
    }
    const detail = await readSetup(user.id, revision.setupId);
    const recentChanges = (detail?.revisionList ?? [])
      .filter((r) => r.changed.length && r.number <= revision.number)
      .slice(0, 5)
      .map((r) => `Revision ${r.number} (${r.kind}): ${r.changed.map((c) => `${c.path} ${c.from} -> ${c.to}`).join('; ')}`);
    const laps = await readLinkedLaps(user.id, revisionId);
    // The conditions only when the driver is in this car right now: the live update says so
    const live = readEngineerSnapshot(user.id);
    const liveHere = live && revision.setup.car && live.update.car.toLowerCase() === revision.setup.car.toLowerCase();

    limit = await aiRateLimit(request, 'setupEngineer', user);
    if (limit.response) return limit.response;
    const rotation = laps?.clientLapIds.length ? await measureSessionRotation(user.id, laps.clientLapIds) : null;
    const answer = await limit.track(() =>
      setupWorkbenchAnswer({
        question,
        setup: {
          name: revision.setup.name,
          car: revision.setup.car,
          track: revision.setup.track,
          parameters: revision.parameters,
          fixedSession: revision.fixedSession,
          loadType: revision.simLoadType,
          simSetupName: revision.simSetupName,
          revisionNumber: revision.number,
          recentChanges,
        },
        comparison,
        laps,
        rotation,
        ...(liveHere ? { weather: weatherContextFromLive(live, Date.now()) } : {}),
        language: user.preferredLanguage,
        units: user.units,
      })
    );
    const proposal = await saveProposal(user.id, {
      setupId: revision.setupId,
      revisionId,
      compareRevisionId: other?.id ?? null,
      question,
      answer: { summary: answer.summary, findings: answer.findings, hypotheses: answer.hypotheses, recommendations: answer.recommendations },
      changes: answer.changes,
    });
    return NextResponse.json({ proposal });
  } catch (error) {
    await limit?.refund();
    if (limit) return aiErrorResponse(error, t.engineerFailed, t.engineerFailed);
    return setupErrorResponse(error, t, 'Setups page Setup Engineer');
  }
}
