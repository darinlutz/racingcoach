import { NextResponse } from 'next/server';
import { ExpertLapError, saveExpertLap } from '@/lib/expertLaps';
import { apiText } from '@/lib/i18n/server';
import { canCoach } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import { MAX_TARGET_LAP_BYTES, TargetLapError } from '@/lib/targetLap';

// The Coach page's Expert Laps section (src/lib/expertLaps.ts).
//   POST  multipart form with `file` = the lap CSV and `replace` = "true" to overwrite the Expert Lap already
//         there for its car and track. Answers { expertLap }, or 409 { existing } when there's one and replace
//         wasn't set.
// Coach and Admin roles only; anyone else gets a 404, like the Coach page.
export async function POST(request: Request) {
  const user = await getCurrentUser();
  const t = await apiText(user);
  try {
    if (!user || !canCoach(user.role)) {
      return NextResponse.json({ error: t.adminOnly }, { status: 404 });
    }
    const form = await request.formData().catch(() => null);
    const file = form?.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: t.missingExpertLap }, { status: 400 });
    }
    if (file.size > MAX_TARGET_LAP_BYTES) {
      return NextResponse.json({ error: t.expertLapErrors.tooLarge }, { status: 400 });
    }

    const replace = form?.get('replace') === 'true';
    const result = await saveExpertLap(user.id, file.name, await file.text(), replace);
    if ('existing' in result) {
      return NextResponse.json({ existing: result.existing }, { status: 409 });
    }
    console.log(`Expert Lap for ${result.saved.car} at ${result.saved.track} ${replace ? 'replaced' : 'added'} by user ${user.id}`);
    return NextResponse.json({ expertLap: result.saved });
  } catch (error) {
    if (error instanceof TargetLapError || error instanceof ExpertLapError) {
      return NextResponse.json(
        { error: t.expertLapErrors[error.code].replace('{columns}', error instanceof TargetLapError ? error.columns.join(', ') : '') },
        { status: 400 }
      );
    }
    console.error('Expert Lap save error:', error);
    return NextResponse.json({ error: t.failedSaveExpertLap }, { status: 500 });
  }
}
