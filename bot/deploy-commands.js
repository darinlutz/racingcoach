import 'dotenv/config';
import { REST, Routes, SlashCommandBuilder } from 'discord.js';

// Registers the bot's slash commands in the RacingCoach.app server only (a guild command), so
// changes show up immediately instead of waiting for global command propagation.
// Run it once, and again whenever a command's name, description or options change.

const { DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID } = process.env;

if (!DISCORD_BOT_TOKEN || !DISCORD_CLIENT_ID || !DISCORD_GUILD_ID) {
  console.error('Missing DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID or DISCORD_GUILD_ID');
  process.exit(1);
}

const commands = [
  new SlashCommandBuilder()
    .setName('command')
    .setDescription('Check that RacingCoach is online'),
  new SlashCommandBuilder()
    .setName('whoami')
    .setDescription('Show which RacingCoach account your Discord account is linked to'),
  new SlashCommandBuilder()
    .setName('coach')
    .setDescription('Get your recent races and AI coaching on your results'),
  new SlashCommandBuilder()
    .setName('debrief')
    .setDescription('See the fixes from your latest Debrief Coach session'),
].map((command) => command.toJSON());

const rest = new REST().setToken(DISCORD_BOT_TOKEN);

try {
  const registered = await rest.put(
    Routes.applicationGuildCommands(DISCORD_CLIENT_ID, DISCORD_GUILD_ID),
    { body: commands },
  );
  console.log(`Registered ${registered.length} command(s): ${registered.map((c) => `/${c.name}`).join(', ')}`);
} catch (error) {
  console.error('Failed to register commands:', error);
  process.exitCode = 1;
}
