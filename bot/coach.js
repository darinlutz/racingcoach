import { EmbedBuilder } from 'discord.js';
import { decimal, fmt, focusLabel, textsFor } from './i18n.js';

// Builds the /coach results card: stats from the driver's recent races (see getRecentRaces in db.js), then
// the AI coach's top three opportunities (see getCoaching in api.js) once they're ready. In the driver's
// language (i18n.js); the coaching comes from the website already in it.

const ACCENT_COLOR = 0xe10600; // racing red
export const NUMBERS = ['1️⃣', '2️⃣', '3️⃣'];

// 83.456 -> "1:23.456" (and "1:23,456" in Portuguese and German; Latin American Spanish, like the site's, keeps the point)
export function formatLapTime(seconds, language = 'en') {
  const minutes = Math.floor(seconds / 60);
  const rest = (seconds - minutes * 60).toFixed(3).padStart(6, '0');
  return `${minutes}:${language === 'pt' || language === 'de' ? rest.replace('.', ',') : rest}`;
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
// `failed` shows a try-again note instead, or says the AI service is out of credits when
// `outOfCredits` is set.
export function buildCoachEmbed(races, coaching, { failed = false, outOfCredits = false, language = 'en' } = {}) {
  const t = textsFor(language);
  const latest = races[0];

  const changes = races.map(iRatingChange).filter((change) => change != null);
  const netIRating = changes.reduce((sum, change) => sum + change, 0);
  const consistencyGap =
    latest.bestLapSeconds != null && latest.averageLapSeconds != null
      ? latest.averageLapSeconds - latest.bestLapSeconds
      : null;

  const results = races
    .map((race) => (race.finishPosition != null ? `P${race.finishPosition}` : t.dnf))
    .join('  ·  ');

  const embed = new EmbedBuilder()
    .setColor(ACCENT_COLOR)
    .setTitle(t.racingAnalysis)
    .setDescription(`${latest.car} · ${latest.track.trim()}`)
    .addFields(
      stat(t.bestLap, latest.bestLapSeconds != null ? formatLapTime(latest.bestLapSeconds, language) : '—'),
      stat(t.avgVsBest, consistencyGap != null ? `+${decimal(language, consistencyGap)} s` : '—'),
      stat(fmt(t.iRatingLast, { n: races.length }), changes.length ? `${netIRating >= 0 ? '▲' : '▼'} ${formatSigned(netIRating)}` : '—'),
      { name: fmt(t.lastFinishes, { n: races.length }), value: results },
    )
    .setFooter({ text: t.raceFooter })
    .setTimestamp(new Date(latest.startTime));

  if (failed) {
    embed.addFields({
      name: t.coachingUnavailable,
      value: outOfCredits ? t.outOfCredits : t.coachingFailed,
    });
  } else if (!coaching) {
    embed.addFields({
      name: t.analyzing,
      value: t.analyzingCopy,
    });
  } else {
    embed.addFields(
      // Field values are limited to 1024 characters and names to 256
      { name: '​', value: `**${t.topThree}**\n*${coaching.summary}*`.slice(0, 1024) },
      ...coaching.opportunities.slice(0, 3).map((opportunity, index) => ({
        name: `${NUMBERS[index]}  ${opportunity.title} — ${focusLabel(language, opportunity.focus)}`.slice(0, 256),
        value: `${opportunity.advice}\n📈 ${opportunity.impact}`.slice(0, 1024),
      })),
    );
  }
  return embed;
}
