import { NextResponse } from 'next/server';
import { readExpertLap } from '@/lib/expertLaps';
import { apiText } from '@/lib/i18n/server';
import { getCurrentUser } from '@/lib/session';
import { setTargetLap } from '@/lib/targetLap';

// The Expert Laps Set Target button (the Coach page and the nav bar's Expert Laps page): copies the Expert Lap
// into the signed-in user's Target Lap (src/lib/targetLap.ts). Answers { targetLap: { fileName, setAt } }.
// Any signed-in user; visitors get a 404.

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const user = await getCurrentUser();
  const t = await apiText(user);
  try {
    if (!user) {
      return NextResponse.json({ error: t.adminOnly }, { status: 404 });
    }
    const { id } = await params;
    const lap = /^\d{1,9}$/.test(id) ? await readExpertLap(Number(id)) : null;
    if (!lap) {
      return NextResponse.json({ error: t.expertLapNotFound }, { status: 404 });
    }
    const targetLap = await setTargetLap(user.id, lap.fileName, lap.csv);
    console.log(`Expert Lap ${id} set as the Target Lap of user ${user.id}`);
    return NextResponse.json({ targetLap });
  } catch (error) {
    console.error('Expert Lap set target error:', error);
    return NextResponse.json({ error: t.failedSaveTargetLap }, { status: 500 });
  }
}
