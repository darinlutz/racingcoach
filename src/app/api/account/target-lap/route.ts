import { NextResponse } from 'next/server';
import { apiText } from '@/lib/i18n/server';
import { getCurrentUser } from '@/lib/session';
import { clearTargetLap, MAX_TARGET_LAP_BYTES, readTargetLap, setTargetLap, TargetLapError } from '@/lib/targetLap';

// The signed-in user's Target Lap (racingcoach."Users"."TargetLap", see src/lib/targetLap.ts), from the Account
// page's Target Lap card and Debrief Coach's Set Target button.
//   GET     the lap's CSV, as a download
//   PUT     multipart form with `file` = the lap CSV; answers { targetLap: { fileName, setAt } }
//   DELETE  removes it

export async function GET() {
  const user = await getCurrentUser();
  const t = await apiText(user);
  try {
    if (!user) {
      return NextResponse.json({ error: t.logInTargetLap }, { status: 401 });
    }
    const lap = await readTargetLap(user.id);
    if (!lap) {
      return NextResponse.json({ error: t.noTargetLap }, { status: 404 });
    }
    // An ASCII fallback name plus the exact name (RFC 6266), as names can hold any characters
    const fallback = lap.fileName.replace(/[^\x20-\x7e]|["\\]/g, '_');
    return new Response(lap.csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(lap.fileName)}`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    console.error('Target lap read error:', error);
    return NextResponse.json({ error: t.failedLoadTargetLap }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const user = await getCurrentUser();
  const t = await apiText(user);
  try {
    if (!user) {
      return NextResponse.json({ error: t.logInTargetLap }, { status: 401 });
    }
    const form = await request.formData().catch(() => null);
    const file = form?.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: t.missingTargetLap }, { status: 400 });
    }
    if (file.size > MAX_TARGET_LAP_BYTES) {
      return NextResponse.json({ error: t.targetLapErrors.tooLarge }, { status: 400 });
    }

    const targetLap = await setTargetLap(user.id, file.name, await file.text());
    return NextResponse.json({ targetLap });
  } catch (error) {
    if (error instanceof TargetLapError) {
      return NextResponse.json(
        { error: t.targetLapErrors[error.code].replace('{columns}', error.columns.join(', ')) },
        { status: 400 }
      );
    }
    console.error('Target lap save error:', error);
    return NextResponse.json({ error: t.failedSaveTargetLap }, { status: 500 });
  }
}

export async function DELETE() {
  const user = await getCurrentUser();
  const t = await apiText(user);
  try {
    if (!user) {
      return NextResponse.json({ error: t.logInTargetLap }, { status: 401 });
    }
    await clearTargetLap(user.id);
    return NextResponse.json({ targetLap: null });
  } catch (error) {
    console.error('Target lap remove error:', error);
    return NextResponse.json({ error: t.failedRemoveTargetLap }, { status: 500 });
  }
}
