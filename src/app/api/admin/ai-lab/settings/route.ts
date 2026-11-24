import { NextResponse } from 'next/server';
import { bad, labAdmin, labBody, unavailable } from '@/lib/aiLab/routeHelpers';
import { MAX_DAILY_CLOUD_BUDGET_USD, validOpenWebuiUrl } from '@/lib/aiLab/rules';
import { audit, getAiLabSettings, saveAiLabSettings } from '@/lib/aiLab/store';

// AI Lab's own settings (docs/AI_LAB_SETUP.md): PUT { openWebuiUrl?, dailyCloudBudgetUsd? }. The Open WebUI address
// is only where Launch Open WebUI goes (https, no path); the website never calls it. Admin role only (404).

export async function PUT(request: Request) {
  const { user, denied } = await labAdmin();
  if (denied) return denied;
  const body = await labBody(request);
  if (body instanceof NextResponse) return body;
  try {
    const settings = await getAiLabSettings();
    if ('openWebuiUrl' in body) {
      if (body.openWebuiUrl === '' || body.openWebuiUrl === null) settings.openWebuiUrl = null;
      else {
        const url = validOpenWebuiUrl(body.openWebuiUrl);
        if (!url) return bad('badUrl');
        settings.openWebuiUrl = url;
      }
    }
    if ('dailyCloudBudgetUsd' in body) {
      const budget = Number(body.dailyCloudBudgetUsd);
      if (!Number.isFinite(budget) || budget < 0 || budget > MAX_DAILY_CLOUD_BUDGET_USD) return bad('badBudget');
      settings.dailyCloudBudgetUsd = budget;
    }
    const saved = await saveAiLabSettings(settings, user.id);
    await audit(user.id, { action: 'settings.save', outcome: 'ok', detail: { openWebuiUrl: saved.openWebuiUrl, dailyCloudBudgetUsd: saved.dailyCloudBudgetUsd } });
    return NextResponse.json({ settings: saved });
  } catch (error) {
    return unavailable(error);
  }
}
