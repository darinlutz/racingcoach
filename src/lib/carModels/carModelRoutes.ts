import { NextResponse } from 'next/server';
import { apiText, getDictionary } from '../i18n/server';
import { fmt } from '../i18n/languages';
import { isAdmin } from '../roles';
import { getCurrentUser } from '../session';
import type { User } from '../users';
import { CarModelError } from './carModelStore.ts';
import type { GlbProblem } from './glb.ts';
import type { ModelProblem } from './modelRules.ts';

// What the Admin page's 3D Car Models routes share: the Admin (404 for anyone else, like every Admin route), their
// language's messages, and a refused upload's problems in words
export type CarModelsText = ReturnType<typeof getDictionary>['setups']['carModels'];

export async function carModelsAdmin(): Promise<{ user: User; t: CarModelsText; response?: undefined } | { response: NextResponse }> {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user.role)) return { response: NextResponse.json({ error: (await apiText(user)).adminOnly }, { status: 404 }) };
  return { user, t: getDictionary(user.preferredLanguage).setups.carModels };
}

export function modelProblemText(problem: ModelProblem, t: CarModelsText): string {
  const p = t.problems;
  switch (problem.code) {
    case 'carKey':
      return fmt(p.carKey, { key: problem.key });
    case 'tooLong':
      return fmt(p.tooLong, { field: t.admin[problem.field] });
    default:
      return p[problem.code];
  }
}

export const glbProblemText = (problem: GlbProblem, t: CarModelsText) => fmt(t.problems.glb[problem.code], { detail: 'detail' in problem ? problem.detail : '' });

export function carModelErrorResponse(error: unknown, t: CarModelsText, what: string): NextResponse {
  if (error instanceof CarModelError) {
    const status = error.code === 'notFound' ? 404 : error.code === 'storageMissing' ? 503 : 409;
    return NextResponse.json({ error: fmt(t.errors[error.code], { car: error.detail ?? '', version: error.detail ?? '' }), code: error.code }, { status });
  }
  console.error(`${what} error:`, error);
  return NextResponse.json({ error: t.errors.failed }, { status: 500 });
}
