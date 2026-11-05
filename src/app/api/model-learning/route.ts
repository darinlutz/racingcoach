import { NextResponse } from 'next/server';
import { canUseModelLearning, runModelLearning } from '@/lib/modelLearning';
import { getCurrentUser } from '@/lib/session';

// The Model Learning page's Run Model button: runs learning/day1_tensors.py and answers what it printed.
// 404 for anyone but Admins and the accounts in modelLearning.ts
export async function POST() {
  const user = await getCurrentUser();
  if (!user || !canUseModelLearning(user)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  try {
    return NextResponse.json(await runModelLearning());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal error' }, { status: 500 });
  }
}
