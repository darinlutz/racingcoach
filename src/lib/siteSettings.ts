import { query } from '@/lib/db';
import { ensureUserSchema } from '@/lib/users';

// Site-wide settings in racingcoach."SiteSettings", changed on the Admin page. A setting with no row
// has its default, so a new database behaves like the site always has.

const SHOW_PRICING = 'show_pricing';
const SHOW_PRO_DRIVER_LESSON = 'show_pro_driver_lesson';

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

const COACH_INSTRUCTIONS = 'ai_coach_instructions';

// Longest AI Coach Instructions the Coach page saves; they go into every coaching prompt
export const MAX_COACH_INSTRUCTIONS = 4000;

// The Coach page's AI Coach Instructions, for every driver's AI coaching; empty when none are saved
export async function getCoachInstructions(): Promise<string> {
  await ensureUserSchema();
  const rows = await query<{ value: string }>('SELECT value FROM racingcoach."SiteSettings" WHERE key = $1', [COACH_INSTRUCTIONS]);
  return rows[0]?.value ?? '';
}

export async function setCoachInstructions(instructions: string, userId: number): Promise<void> {
  await ensureUserSchema();
  await query(
    `INSERT INTO racingcoach."SiteSettings" (key, value, updated_by) VALUES ($1, $2, $3)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [COACH_INSTRUCTIONS, instructions, userId]
  );
}

// Appended to the AI coaching prompts (Debrief Coach, the lap and stint summaries, Race
// Trends and the Discord bot's coaching) so the coaches' instructions steer them. They can't override the
// data rules: the model still only has the tools and data each feature gives it. A failed read only loses
// the instructions, not the coaching.
export async function coachInstructionsRule(): Promise<string> {
  try {
    const instructions = (await getCoachInstructions()).trim();
    if (!instructions) return '';
    return (
      '\n\nThe head coach has given these standing instructions for how you coach. Follow them, unless one needs ' +
      'data you do not have or breaks the rules above; never invent data to follow them.\n' +
      `<coach_instructions>\n${instructions}\n</coach_instructions>`
    );
  } catch (error) {
    console.error('Failed to read the AI Coach Instructions:', error);
    return '';
  }
}
