import { EmbedBuilder } from 'discord.js';
import { formatLapTime, NUMBERS } from './coach.js';
import { decimal, fmt, focusLabel, textsFor } from './i18n.js';

// Builds the /coach debrief card from the driver's latest saved Debrief Coach run (see getLatestDebrief
// in db.js): the session's best lap, the time the fixes are worth, and each fix. In the driver's language
// (i18n.js); the fixes were written by the coach in the language the driver had when they ran it.

const ACCENT_COLOR = 0xe10600; // racing red, same as /coach results

// 0.197 -> "0.20 sec"
function formatGain(seconds, language) {
  return fmt(textsFor(language).seconds, { n: decimal(language, seconds) });
}

// Focus area names are whatever the driver typed in Track Data; spell out the common shorthands:
// "T 10" -> "Turn 10", "T 1&2" -> "Turns 1 & 2", "12-14" -> "Turns 12–14" (in the driver's language). Anything
// else is kept.
export function areaName(area, language = 'en') {
  const t = textsFor(language);
  const name = area.trim();
  let match;
  if ((match = name.match(/^(?:T|Turn)?\s*(\d+)$/i))) return fmt(t.turn, { n: match[1] });
  if ((match = name.match(/^(?:T|Turns?)?\s*(\d+)\s*&\s*(\d+)$/i))) return fmt(t.turnsAnd, { a: match[1], b: match[2] });
  if ((match = name.match(/^(?:T|Turns?)?\s*(\d+)\s*-\s*(\d+)$/i))) return fmt(t.turnsRange, { a: match[1], b: match[2] });
  return name;
}

// What the fix changes. Debriefs saved before the coach labeled it: tell it from the wording, or none.
function fixFocus(fix) {
  if (fix.focus) return fix.focus;
  if (/\bbrake about \d+ (?:ft|m) (later|earlier)/i.test(fix.fix)) return 'Braking';
  if (/brake pressure/i.test(fix.fix)) return 'Brake pressure';
  return null;
}

// The heading already names the area, so drop a trailing "in T 10." from the fix
function fixAction(fix) {
  const area = fix.area.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return fix.fix.replace(new RegExp(`,?\\s+(?:in|at|through|em|en|no|na|in der|im)\\s+${area}\\.?$`, 'i'), '.');
}

export function buildDebriefEmbed({ track, car, lapCount, bestLapSeconds, debrief, createdAt }, language = 'en') {
  const t = textsFor(language);
  const fixes = (debrief.fixes ?? []).slice(0, 3);
  const totalGain = fixes.reduce((sum, fix) => sum + (fix.timeGainSeconds ?? 0), 0);
  // Discord shows <t:...:R> as e.g. "2 hours ago" in each reader's own time zone and language
  const when = `<t:${Math.floor(new Date(createdAt).getTime() / 1000)}:R>`;

  const embed = new EmbedBuilder()
    .setColor(ACCENT_COLOR)
    .setTitle(t.sessionDebrief)
    .setDescription(`${car} · ${track}\n${fmt(t.lapsAnalyzed, { n: lapCount, when })}`)
    .addFields(
      // Headings render larger inside embed fields
      { name: t.bestLap, value: `### ${formatLapTime(bestLapSeconds, language)}`, inline: true },
      { name: t.potentialGain, value: `### −${formatGain(totalGain, language)}`, inline: true },
      { name: '​', value: `**${fixes.length === 1 ? t.topOne : fmt(t.topN, { n: fixes.length })}**` },
      // Field names are limited to 256 characters and values to 1024
      ...fixes.map((fix, index) => ({
        name: [`${NUMBERS[index]}  ${areaName(fix.area, language)}`, focusLabel(language, fixFocus(fix))]
          .filter(Boolean)
          .join(' — ')
          .slice(0, 256),
        value: `**${fixAction(fix)}**\n${fix.problem}\n🟢 ${t.potentialGain}: ${formatGain(fix.timeGainSeconds ?? 0, language)}`.slice(0, 1024),
      })),
    )
    .setFooter({ text: t.debriefFooter })
    .setTimestamp(new Date(createdAt));

  const keepDoing = (debrief.keepDoing ?? []).slice(0, 3);
  if (keepDoing.length) {
    embed.addFields({ name: t.keepDoing, value: keepDoing.map((item) => `• ${item}`).join('\n').slice(0, 1024) });
  }
  return embed;
}
