import 'dotenv/config';
import { Client, Events, GatewayIntentBits, MessageFlags } from 'discord.js';
import { getCoaching } from './api.js';
import { buildCoachEmbed } from './coach.js';
import { closeDb, getLatestDebrief, getLinkedUser, getRecentDebriefs, getRecentRaces, getShowPricing } from './db.js';
import { buildDebriefEmbed } from './debrief.js';
import { fmt, languageFor, localeOf, textsFor } from './i18n.js';
import { buildRecentEmbed } from './recent.js';

// The RacingCoach Discord bot. Keeps a connection open to Discord and answers slash commands.
// Commands are registered separately by deploy-commands.js.

const { DISCORD_BOT_TOKEN } = process.env;

if (!DISCORD_BOT_TOKEN) {
  console.error('Missing DISCORD_BOT_TOKEN');
  process.exit(1);
}

// Slash commands only need the Guilds intent (no message content or member access)
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, (readyClient) => {
  console.log(`RacingCoach bot logged in as ${readyClient.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  // All commands are subcommands of /coach (see deploy-commands.js)
  if (interaction.commandName !== 'coach') return;
  const subcommand = interaction.options.getSubcommand();

  try {
    if (subcommand === 'status') {
      const user = await getLinkedUser(interaction.user.id).catch(() => null);
      await interaction.reply(textsFor(languageFor(user, interaction.locale)).online);
    } else if (subcommand === 'whoami') {
      await handleWhoami(interaction);
    } else if (subcommand === 'results') {
      await handleCoach(interaction);
    } else if (subcommand === 'debrief') {
      await handleDebrief(interaction);
    } else if (subcommand === 'recent') {
      await handleRecent(interaction);
    }
  } catch (error) {
    console.error(`Error handling /coach ${subcommand}:`, error);
    const message = { content: textsFor(languageFor(null, interaction.locale)).somethingWrong, flags: MessageFlags.Ephemeral };
    if (interaction.deferred && !interaction.replied) {
      await interaction.editReply(message).catch(() => {});
    } else if (interaction.replied) {
      await interaction.followUp(message).catch(() => {});
    } else {
      await interaction.reply(message).catch(() => {});
    }
  }
});

// A page on the website, e.g. sitePage('/account'), or `fallback` when SITE_URL isn't set
function sitePage(path, fallback) {
  const siteUrl = process.env.SITE_URL?.trim().replace(/\/+$/, '');
  return siteUrl ? `${siteUrl}${path}` : fallback;
}

// Before an account is linked, Discord's language for the user picks the reply's
function notLinkedMessage(interaction) {
  const t = textsFor(languageFor(null, interaction.locale));
  return fmt(t.notLinked, { page: sitePage('/account', t.accountPage) });
}

// AI features are for Silver and Gold members and Admins, like the website's (notForBronze in src/lib/ragRoute.ts).
// Every command that calls the website's AI checks this first and answers upgradeMessage instead.
function needsUpgrade(user) {
  return user.membershipLevel === 'Bronze' && user.role !== 'Admin';
}

// Points to the Pricing page, or the Account page while the Admin page's Show Pricing is off
async function upgradeMessage(command, language) {
  const t = textsFor(language);
  const page = (await getShowPricing()) ? sitePage('/pricing', t.pricingPage) : sitePage('/account', t.accountPage);
  return fmt(t.upgrade, { command, page });
}

// e.g. "Silver Member since March 2026", in the user's language
function membershipText(user, language) {
  const t = textsFor(language);
  if (!user.memberSince) return fmt(t.member, { level: user.membershipLevel });
  const since = user.memberSince.toLocaleDateString(localeOf(language), { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return fmt(t.memberSince, { level: user.membershipLevel, since });
}

// Only the person who ran it sees the reply, since it names their account
async function handleWhoami(interaction) {
  const user = await getLinkedUser(interaction.user.id);
  const language = languageFor(user, interaction.locale);
  await interaction.reply({
    content: user
      ? fmt(textsFor(language).linked, { name: user.userName, membership: membershipText(user, language) })
      : notLinkedMessage(interaction),
    flags: MessageFlags.Ephemeral,
  });
}

const COACH_RACE_COUNT = 5;

// Summarizes the driver's most recent races, visible only to them. For Admins only, like the website's
// My Race Trends (the website's /api/bot/coach refuses anyone else too). The reply is deferred first
// ("RacingCoach is thinking..."): Discord drops interactions not answered within 3 seconds.
async function handleCoach(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const user = await getLinkedUser(interaction.user.id);
  if (!user) {
    await interaction.editReply(notLinkedMessage(interaction));
    return;
  }
  const language = languageFor(user, interaction.locale);
  const t = textsFor(language);
  if (needsUpgrade(user)) {
    await interaction.editReply(await upgradeMessage('/coach results', language));
    return;
  }
  if (user.role !== 'Admin') {
    await interaction.editReply(t.adminsOnly);
    return;
  }

  const races = await getRecentRaces(user.id, COACH_RACE_COUNT);
  if (!races.length) {
    await interaction.editReply(fmt(t.noRaces, { name: user.userName, page: sitePage('/race-trends', t.raceTrendsPage) }));
    return;
  }

  // Show the stats right away; the AI coaching takes longer and is added when it's ready
  await interaction.editReply({ embeds: [buildCoachEmbed(races, null, { language })] });

  try {
    const coaching = await getCoaching(interaction.user.id);
    await interaction.editReply({ embeds: [buildCoachEmbed(races, coaching, { language })] });
  } catch (error) {
    console.error('Coaching error:', error);
    if (error.code === 'membership_required') {
      await interaction.editReply({ content: await upgradeMessage('/coach results', language), embeds: [] });
      return;
    }
    const outOfCredits = error.code === 'out_of_credits';
    await interaction.editReply({ embeds: [buildCoachEmbed(races, null, { failed: true, outOfCredits, language })] });
  }
}

// Shows the driver's latest saved Debrief Coach run, visible only to them. No AI call: the website
// saved the debrief when they ran it.
async function handleDebrief(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const user = await getLinkedUser(interaction.user.id);
  if (!user) {
    await interaction.editReply(notLinkedMessage(interaction));
    return;
  }
  const language = languageFor(user, interaction.locale);

  const saved = await getLatestDebrief(user.id);
  if (!saved) {
    await interaction.editReply(noDebriefsMessage(user, language));
    return;
  }

  await interaction.editReply({ embeds: [buildDebriefEmbed(saved, language)] });
}

const RECENT_SESSION_COUNT = 5;

// Lists the driver's last few saved Debrief Coach sessions, visible only to them
async function handleRecent(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const user = await getLinkedUser(interaction.user.id);
  if (!user) {
    await interaction.editReply(notLinkedMessage(interaction));
    return;
  }
  const language = languageFor(user, interaction.locale);

  const sessions = await getRecentDebriefs(user.id, RECENT_SESSION_COUNT);
  if (!sessions.length) {
    await interaction.editReply(noDebriefsMessage(user, language));
    return;
  }

  await interaction.editReply({ embeds: [buildRecentEmbed(sessions, language)] });
}

function noDebriefsMessage(user, language) {
  const t = textsFor(language);
  return fmt(t.noDebriefs, { name: user.userName, page: sitePage('/racing', t.racingPage) });
}

// Let Render stop the worker cleanly on redeploys
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log(`Received ${signal}, shutting down`);
    Promise.allSettled([client.destroy(), closeDb()]).finally(() => process.exit(0));
  });
}

client.login(DISCORD_BOT_TOKEN);
