import { EmbedBuilder } from 'discord.js';

// Builds the /coach card: stats from the driver's recent races (see getRecentRaces in db.js), then
// the AI coach's top three opportunities (see getCoaching in api.js) once they're ready.

const ACCENT_COLOR = 0xe10600; // racing red
export const NUMBERS = ['1️⃣', '2️⃣', '3️⃣'];

// 83.456 -> "1:23.456"
export function formatLapTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const rest = (seconds - minutes * 60).toFixed(3).padStart(6, '0');
  return `${minutes}:${rest}`;
}

function formatSigned(value) {
  return value > 0 ? `+${value}` : `${value}`;
}

function iRatingChange(race) {
  return race.oldIRating != null && race.newIRating != null ? race.newIRating - race.oldIRating : null;
}

// A big number in a stat column; headings render larger inside embed fields
function stat(name, value) {
  return { name, value: `### ${value}`, inline: true };
}

// `coaching` is the website's { summary, opportunities }, or null while it's being written.
// `failed` shows a try-again note instead.
export function buildCoachEmbed(races, coaching, { failed = false } = {}) {
  const latest = races[0];

  const changes = races.map(iRatingChange).filter((change) => change != null);
  const netIRating = changes.reduce((sum, change) => sum + change, 0);
  const consistencyGap =
    latest.bestLapSeconds != null && latest.averageLapSeconds != null
      ? latest.averageLapSeconds - latest.bestLapSeconds
      : null;

  const results = races
    .map((race) => (race.finishPosition != null ? `P${race.finishPosition}` : 'DNF'))
    .join('  ·  ');

  const embed = new EmbedBuilder()
    .setColor(ACCENT_COLOR)
    .setTitle('🏁 Your Racing Analysis')
    .setDescription(`${latest.car} · ${latest.track.trim()}`)
    .addFields(
      stat('Best lap', latest.bestLapSeconds != null ? formatLapTime(latest.bestLapSeconds) : '—'),
      stat('Avg vs best lap', consistencyGap != null ? `+${consistencyGap.toFixed(2)}s` : '—'),
      stat(`iRating · last ${races.length}`, changes.length ? `${netIRating >= 0 ? '▲' : '▼'} ${formatSigned(netIRating)}` : '—'),
      { name: `Last ${races.length} finishes (newest first)`, value: results },
    )
    .setFooter({ text: 'RacingCoach.app · AI-powered race analysis' })
    .setTimestamp(new Date(latest.startTime));

  if (failed) {
    embed.addFields({
      name: '⚠️ Coaching unavailable',
      value: "The AI coach couldn't analyze your races right now. Please try again in a few minutes.",
    });
  } else if (!coaching) {
    embed.addFields({
      name: '⏳ Analyzing your races…',
      value: 'Your coach is reviewing all of your races. This can take up to a minute.',
    });
  } else {
    embed.addFields(
      // Field values are limited to 1024 characters and names to 256
      { name: '​', value: `**Your top 3 opportunities**\n*${coaching.summary}*`.slice(0, 1024) },
      ...coaching.opportunities.slice(0, 3).map((opportunity, index) => ({
        name: `${NUMBERS[index]}  ${opportunity.title} — ${opportunity.focus}`.slice(0, 256),
        value: `${opportunity.advice}\n📈 ${opportunity.impact}`.slice(0, 1024),
      })),
    );
  }
  return embed;
}
