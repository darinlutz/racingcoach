import { EmbedBuilder } from 'discord.js';
import { formatLapTime } from './coach.js';

// Builds the /coach recent card: the driver's last few saved Debrief Coach sessions (see
// getRecentDebriefs in db.js), one line each, newest first. /coach debrief shows the latest in full.

const ACCENT_COLOR = 0xe10600; // racing red, same as /coach results

export function buildRecentEmbed(sessions) {
  const embed = new EmbedBuilder()
    .setColor(ACCENT_COLOR)
    .setTitle('🏁 Your Recent Sessions')
    .setDescription(`Your last ${sessions.length} Debrief Coach ${sessions.length === 1 ? 'session' : 'sessions'}, newest first`)
    .addFields(
      // Field names are limited to 256 characters and values to 1024
      sessions.map(({ track, car, lapCount, bestLapSeconds, debrief, createdAt }) => {
        const totalGain = (debrief.fixes ?? []).slice(0, 3).reduce((sum, fix) => sum + (fix.timeGainSeconds ?? 0), 0);
        // Discord shows <t:...:R> as e.g. "2 hours ago" in each reader's own time zone
        const when = `<t:${Math.floor(new Date(createdAt).getTime() / 1000)}:R>`;
        return {
          name: `${car} · ${track}`.slice(0, 256),
          value: `Best lap **${formatLapTime(bestLapSeconds)}** · ${lapCount} laps · −${totalGain.toFixed(2)} sec potential · ${when}`,
        };
      }),
    )
    .setFooter({ text: 'RacingCoach.app · Run /coach debrief for your latest fixes' })
    .setTimestamp(new Date(sessions[0].createdAt));
  return embed;
}
