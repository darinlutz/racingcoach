import 'dotenv/config';
import { Client, Events, GatewayIntentBits, MessageFlags } from 'discord.js';

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
    }
  } catch (error) {
    console.error(`Error handling /${interaction.commandName}:`, error);
    const message = { content: 'Something went wrong running that command.', flags: MessageFlags.Ephemeral };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(message).catch(() => {});
    } else {
      await interaction.reply(message).catch(() => {});
    }
  }
});

// Let Render stop the worker cleanly on redeploys
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log(`Received ${signal}, shutting down`);
    client.destroy().finally(() => process.exit(0));
  });
}

client.login(DISCORD_BOT_TOKEN);
