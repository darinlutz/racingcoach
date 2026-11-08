import { EmbedBuilder } from 'discord.js';
import { formatLapTime } from './coach.js';
import { decimal, fmt, textsFor } from './i18n.js';

// Builds the /coach recent card: the driver's last few saved Debrief Coach sessions (see
// getRecentDebriefs in db.js), one line each, newest first, in the driver's language (i18n.js).
// /coach debrief shows the latest in full.

const ACCENT_COLOR = 0xe10600; // racing red, same as /coach results

export function buildRecentEmbed(sessions, language = 'en') {
  const t = textsFor(language);
  const embed = new EmbedBuilder()
    .setColor(ACCENT_COLOR)
    .setTitle(t.recentSessions)
    .setDescription(sessions.length === 1 ? t.lastSessionsOne : fmt(t.lastSessions, { n: sessions.length }))
    .addFields(
      // Field names are limited to 256 characters and values to 1024
      sessions.map(({ track, car, lapCount, bestLapSeconds, debrief, createdAt }) => {
        const totalGain = (debrief.fixes ?? []).slice(0, 3).reduce((sum, fix) => sum + (fix.timeGainSeconds ?? 0), 0);
        // Discord shows <t:...:R> as e.g. "2 hours ago" in each reader's own time zone and language
        const when = `<t:${Math.floor(new Date(createdAt).getTime() / 1000)}:R>`;
        return {
          name: `${car} · ${track}`.slice(0, 256),
          value: fmt(t.recentLine, {
            best: formatLapTime(bestLapSeconds, language),
            laps: lapCount,
            gain: decimal(language, totalGain),
            when,
          }),
        };
      }),
    )
    .setFooter({ text: t.recentFooter })
    .setTimestamp(new Date(sessions[0].createdAt));
  return embed;
}
