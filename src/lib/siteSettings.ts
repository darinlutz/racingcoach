import { query } from '@/lib/db';
import { ensureUserSchema } from '@/lib/users';

// Site-wide settings in racingcoach."SiteSettings", changed on the Admin page. A setting with no row
// has its default, so a new database behaves like the site always has.

const SHOW_PRICING = 'show_pricing';
const SHOW_PRO_DRIVER_LESSON = 'show_pro_driver_lesson';
const ENABLE_AI_FEATURES = 'enable_ai_features';

// An on/off setting; on when it has no row
async function getSwitch(key: string): Promise<boolean> {
  await ensureUserSchema();
  const rows = await query<{ value: string }>('SELECT value FROM racingcoach."SiteSettings" WHERE key = $1', [key]);
  return rows.length === 0 ? true : rows[0].value === 'true';
}

async function setSwitch(key: string, on: boolean, userId: number): Promise<void> {
  await ensureUserSchema();
  await query(
    `INSERT INTO racingcoach."SiteSettings" (key, value, updated_by) VALUES ($1, $2, $3)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [key, String(on), userId]
  );
}

// Whether the navigation bar shows the Pricing link, and the Account page its View Membership Plans button
// (to everyone; Gold subscribers never see them)
export async function getShowPricing(): Promise<boolean> {
  return getSwitch(SHOW_PRICING);
}

export async function setShowPricing(show: boolean, userId: number): Promise<void> {
  await setSwitch(SHOW_PRICING, show, userId);
}

// Whether the navigation bar shows the 1:1 Pro Driver Lesson link (to everyone)
export async function getShowProDriverLesson(): Promise<boolean> {
  return getSwitch(SHOW_PRO_DRIVER_LESSON);
}

export async function setShowProDriverLesson(show: boolean, userId: number): Promise<void> {
  await setSwitch(SHOW_PRO_DRIVER_LESSON, show, userId);
}

// Whether the logo's tagline reads YOUR AI RACE ENGINEER (on) or YOUR PERSONAL RACE ENGINEER (off), for everyone
export async function getEnableAiFeatures(): Promise<boolean> {
  return getSwitch(ENABLE_AI_FEATURES);
}

export async function setEnableAiFeatures(enable: boolean, userId: number): Promise<void> {
  await setSwitch(ENABLE_AI_FEATURES, enable, userId);
}
