import { EmbedBuilder } from 'discord.js';
import { formatLapTime, NUMBERS } from './coach.js';

// Builds the /debrief card from the driver's latest saved Debrief Coach run (see getLatestDebrief
// in db.js): the session's best lap, the time the fixes are worth, and each fix.

const ACCENT_COLOR = 0xe10600; // racing red, same as /coach

// 0.197 -> "0.20 sec"
function formatGain(seconds) {
  return `${seconds.toFixed(2)} sec`;
}

// Focus area names are whatever the driver typed in Track Data; spell out the common shorthands:
// "T 10" -> "Turn 10", "T 1&2" -> "Turns 1 & 2", "12-14" -> "Turns 12–14". Anything else is kept.
export function areaName(area) {
  const name = area.trim();
  let match;
  if ((match = name.match(/^(?:T|Turn)?\s*(\d+)$/i))) return `Turn ${match[1]}`;
  if ((match = name.match(/^(?:T|Turns?)?\s*(\d+)\s*&\s*(\d+)$/i))) return `Turns ${match[1]} & ${match[2]}`;
  if ((match = name.match(/^(?:T|Turns?)?\s*(\d+)\s*-\s*(\d+)$/i))) return `Turns ${match[1]}–${match[2]}`;
  return name;
}

// What the fix changes. Debriefs saved before the coach labeled it: tell it from the wording, or none.
function fixFocus(fix) {
  if (fix.focus) return fix.focus;
  if (/\bbrake about \d+ ft (later|earlier)/i.test(fix.fix)) return 'Braking';
  if (/brake pressure/i.test(fix.fix)) return 'Brake pressure';
  return null;
}

// The heading already names the area, so drop a trailing "in T 10." from the fix
function fixAction(fix) {
  const area = fix.area.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return fix.fix.replace(new RegExp(`,?\\s+(?:in|at|through)\\s+${area}\\.?$`, 'i'), '.');
}

export function buildDebriefEmbed({ track, car, lapCount, bestLapSeconds, debrief, createdAt }) {
  const fixes = (debrief.fixes ?? []).slice(0, 3);
  const totalGain = fixes.reduce((sum, fix) => sum + (fix.timeGainSeconds ?? 0), 0);
  // Discord shows <t:...:R> as e.g. "2 hours ago" in each reader's own time zone
  const when = `<t:${Math.floor(new Date(createdAt).getTime() / 1000)}:R>`;

  const embed = new EmbedBuilder()
    .setColor(ACCENT_COLOR)
    .setTitle('🏁 Your Session Debrief')
    .setDescription(`${car} · ${track}\n${lapCount} laps analyzed ${when}`)
    .addFields(
      // Headings render larger inside embed fields
      { name: 'Best lap', value: `### ${formatLapTime(bestLapSeconds)}`, inline: true },
      { name: 'Potential gain', value: `### −${formatGain(totalGain)}`, inline: true },
      { name: '​', value: `**Your top ${fixes.length} ${fixes.length === 1 ? 'opportunity' : 'opportunities'}**` },
      // Field names are limited to 256 characters and values to 1024
      ...fixes.map((fix, index) => ({
        name: [`${NUMBERS[index]}  ${areaName(fix.area)}`, fixFocus(fix)].filter(Boolean).join(' — ').slice(0, 256),
        value: `**${fixAction(fix)}**\n${fix.problem}\n🟢 Potential gain: ${formatGain(fix.timeGainSeconds ?? 0)}`.slice(0, 1024),
      })),
    )
    .setFooter({ text: 'RacingCoach.app · AI-powered driving analysis' })
    .setTimestamp(new Date(createdAt));

  const keepDoing = (debrief.keepDoing ?? []).slice(0, 3);
  if (keepDoing.length) {
    embed.addFields({ name: '✅ Keep doing', value: keepDoing.map((item) => `• ${item}`).join('\n').slice(0, 1024) });
  }
  return embed;
}
