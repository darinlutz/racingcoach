import { NextResponse } from 'next/server';
import { getDictionary } from '@/lib/i18n/server';
import { fmt } from '@/lib/i18n/languages';
import { changeSheet } from '@/lib/setupChanges';
import { idOf, setupErrorResponse, setupsSession } from '@/lib/setupRoutes';
import { markChangeSheet, readRevision } from '@/lib/setups';

// A revision's changes as a text sheet to set in iRacing's garage by hand: RacingCoach can't write a .sto file iRacing
// would accept (iRacing encrypts and signs them, src/lib/stoFile.ts), so this is how a revision gets into iRacing.
// Recorded in the setup's history
export async function GET(_request: Request, { params }: { params: Promise<{ revisionId: string }> }) {
  const session = await setupsSession();
  if (session.response) return session.response;
  const id = idOf((await params).revisionId);
  if (!id) return NextResponse.json({ error: session.t.notFound }, { status: 404 });
  try {
    const revision = await readRevision(session.user.id, id);
    if (!revision) return NextResponse.json({ error: session.t.notFound }, { status: 404 });
    if (!revision.changed.length) return NextResponse.json({ error: session.t.badChange }, { status: 400 });
    const text = getDictionary(session.user.preferredLanguage).setups.history;
    const sheet = changeSheet(fmt(text.changeSheetTitle, { setup: revision.setup.name, number: revision.number }), revision.changed, {
      from: text.from,
      to: text.to,
    });
    await markChangeSheet(session.user.id, id);
    const name = `${revision.setup.name} rev ${revision.number}.txt`.replace(/[^\w .()-]/g, '_');
    return new NextResponse(sheet, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="${name}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    return setupErrorResponse(error, session.t, 'Setup change sheet');
  }
}
