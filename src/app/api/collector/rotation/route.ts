import { NextResponse } from 'next/server';
import { readCollectorLapsById } from '@/lib/collectorLaps';
import { analyzeRotationSession } from '@/lib/rotationAnalysis';
import { calibrationForCar, ROTATION_MODEL_CONFIG } from '@/lib/rotationModelConfig';
import { getCurrentUser } from '@/lib/session';
import { apiText } from '@/lib/i18n/server';

// Same limit as the In-Car AI Coach's lap feedback
const MAX_LAPS = 30;

// Understeer and oversteer in uploaded laps: GET /api/collector/rotation?ids=12,13,14 runs the Rotation Model
// (the collector's live overlay model, see rotation-model/README.md) over each lap and answers its events, a
// summary, and the places they keep happening lap after lap. Users can only analyse their own and Coaches' laps
// (anyone else's are left out, as if they didn't exist); Coaches and Admins can analyse any driver's.
export async function GET(request: Request) {
  const t = await apiText();
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: t.logInRecordedLaps }, { status: 401 });
    }
    const raw = new URL(request.url).searchParams.get('ids') ?? '';
    const ids = [...new Set(raw.split(',').map((id) => id.trim()).filter(Boolean))];
    if (ids.length === 0 || ids.length > MAX_LAPS || !ids.every((id) => /^\d{1,9}$/.test(id))) {
      return NextResponse.json({ error: t.lapNotFound }, { status: 400 });
    }

    const laps = await readCollectorLapsById(user, ids.map(Number));
    if (laps.length === 0) {
      return NextResponse.json({ error: t.lapNotFound }, { status: 404 });
    }
    const analysis = analyzeRotationSession(laps, ROTATION_MODEL_CONFIG, (car) => (car ? calibrationForCar(car) : null));
    return NextResponse.json({ modelVersion: ROTATION_MODEL_CONFIG.modelVersion, ...analysis });
  } catch (error) {
    console.error('Rotation analysis error:', error);
    return NextResponse.json({ error: t.failedLoadLap }, { status: 500 });
  }
}
