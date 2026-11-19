import { NextResponse } from 'next/server';
import { apiText, getDictionary } from '../i18n/server';
import { fmt } from '../i18n/languages';
import { isAdmin } from '../roles';
import { getCurrentUser } from '../session';
import type { User } from '../users';
import type { DraftProblem } from './assetRules.ts';
import { CarViewActionError } from './carViewStore';

// What the Admin page's Engineering Car Drawings routes share: the Admin (404 for anyone else, like every Admin
// route), their language's messages, and the problems of a refused draft in words
export type CarViewsText = ReturnType<typeof getDictionary>['setups']['carViews'];

export async function carViewsAdmin(): Promise<{ user: User; t: CarViewsText; response?: undefined } | { response: NextResponse }> {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user.role)) return { response: NextResponse.json({ error: (await apiText(user)).adminOnly }, { status: 404 }) };
  return { user, t: getDictionary(user.preferredLanguage).setups.carViews };
}

export function draftProblemText(problem: DraftProblem, t: CarViewsText): string {
  const p = t.problems;
  switch (problem.code) {
    case 'svg':
      return fmt(p.svg[problem.problem.code], { view: t.views[problem.view], detail: 'detail' in problem.problem ? problem.problem.detail : '' });
    case 'anchors': {
      const a = problem.problem;
      return fmt(p.anchors[a.code], {
        view: t.views[problem.view],
        anchor: 'anchor' in a ? a.anchor : '',
        corner: 'corner' in a ? a.corner : '',
        first: 'first' in a ? a.first : '',
        second: 'second' in a ? a.second : '',
      });
    }
    case 'carKey':
      return fmt(p.carKey, { key: problem.key });
    case 'unknownView':
      return fmt(p.unknownView, { view: problem.view });
    case 'tooLong':
      return fmt(p.tooLong, { field: t.admin[problem.field] });
    default:
      return p[problem.code];
  }
}

export function carViewErrorResponse(error: unknown, t: CarViewsText, what: string): NextResponse {
  if (error instanceof CarViewActionError) {
    const status = error.code === 'notFound' ? 404 : 409;
    return NextResponse.json({ error: fmt(t.errors[error.code], { car: error.detail ?? '' }), code: error.code }, { status });
  }
  console.error(`${what} error:`, error);
  return NextResponse.json({ error: t.errors.failed }, { status: 500 });
}
