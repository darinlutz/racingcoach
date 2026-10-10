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

// Everything is grouped under /coach as subcommands (/coach results, /coach debrief, ...). Discord
// doesn't allow running a command that has subcommands on its own, so plain /coach isn't available.
const commands = [
  new SlashCommandBuilder()
    .setName('coach')
    .setDescription('RacingCoach commands')
    .addSubcommand((sub) => sub
      .setName('results')
      .setDescription('Get your recent races and AI coaching on your results'))
    .addSubcommand((sub) => sub
      .setName('debrief')
      .setDescription('See the fixes from your latest Debrief Coach session'))
    .addSubcommand((sub) => sub
      .setName('recent')
      .setDescription('List your recent Debrief Coach sessions'))
    .addSubcommand((sub) => sub
      .setName('whoami')
      .setDescription('Show which RacingCoach account your Discord account is linked to'))
    .addSubcommand((sub) => sub
      .setName('status')
      .setDescription('Check that RacingCoach is online')),
].map((command) => command.toJSON());

const rest = new REST().setToken(DISCORD_BOT_TOKEN);

try {
  const registered = await rest.put(
    Routes.applicationGuildCommands(DISCORD_CLIENT_ID, DISCORD_GUILD_ID),
    { body: commands },
  );
  const names = registered.flatMap((c) => c.options?.length ? c.options.map((o) => `/${c.name} ${o.name}`) : [`/${c.name}`]);
  console.log(`Registered ${names.length} command(s): ${names.join(', ')}`);
} catch (error) {
  console.error('Failed to register commands:', error);
  process.exitCode = 1;
}
