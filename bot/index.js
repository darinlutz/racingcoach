import 'dotenv/config';
import { Client, Events, GatewayIntentBits, MessageFlags } from 'discord.js';
import { getCoaching } from './api.js';
import { buildCoachEmbed } from './coach.js';
import { closeDb, getLinkedUser, getRecentRaces } from './db.js';

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

  try {
    if (interaction.commandName === 'command') {
      await interaction.reply('RacingCoach is online! Your racing coach is ready.');
    } else if (interaction.commandName === 'whoami') {
      await handleWhoami(interaction);
    } else if (interaction.commandName === 'coach') {
      await handleCoach(interaction);
    }
  } catch (error) {
    console.error(`Error handling /${interaction.commandName}:`, error);
    const message = { content: 'Something went wrong running that command.', flags: MessageFlags.Ephemeral };
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

function notLinkedMessage() {
  const accountPage = sitePage('/account', 'the RacingCoach Account page');
  return `Your Discord account isn't linked to RacingCoach yet. Sign in and click **Connect Discord** on ${accountPage}.`;
}

// Only the person who ran it sees the reply, since it names their account
async function handleWhoami(interaction) {
  const user = await getLinkedUser(interaction.user.id);
  await interaction.reply({
    content: user
      ? `You're linked to the RacingCoach account **${user.userName}** (${user.accountStatus}).`
      : notLinkedMessage(),
    flags: MessageFlags.Ephemeral,
  });
}

const COACH_RACE_COUNT = 5;

// Summarizes the driver's most recent races, visible only to them. The reply is deferred first
// ("RacingCoach is thinking..."): Discord drops interactions not answered within 3 seconds.
async function handleCoach(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const user = await getLinkedUser(interaction.user.id);
  if (!user) {
    await interaction.editReply(notLinkedMessage());
    return;
  }

  const races = await getRecentRaces(user.id, COACH_RACE_COUNT);
  if (!races.length) {
    const raceTrends = sitePage('/race-trends', 'the My Race Trends page');
    await interaction.editReply(
      `No races found for **${user.userName}** yet. Connect iRacePlan and load your races on ${raceTrends}.`,
    );
    return;
  }

  // Show the stats right away; the AI coaching takes longer and is added when it's ready
  await interaction.editReply({ embeds: [buildCoachEmbed(races, null)] });

  try {
    const coaching = await getCoaching(interaction.user.id);
    await interaction.editReply({ embeds: [buildCoachEmbed(races, coaching)] });
  } catch (error) {
    console.error('Coaching error:', error);
    await interaction.editReply({ embeds: [buildCoachEmbed(races, null, { failed: true })] });
  }
}

// Let Render stop the worker cleanly on redeploys
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log(`Received ${signal}, shutting down`);
    Promise.allSettled([client.destroy(), closeDb()]).finally(() => process.exit(0));
  });
}

client.login(DISCORD_BOT_TOKEN);
