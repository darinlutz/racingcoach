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

// Each description in English and in the site's other languages. Discord shows the one for the reader's Discord
// language (it can't know their RacingCoach Preferred Language, which the replies are in, see i18n.js); its
// Spanish locales are Spain's and Latin America's, both given the site's Spanish.
const DESCRIPTIONS = {
  coach: {
    en: 'RacingCoach commands',
    pt: 'Comandos do RacingCoach',
    es: 'Comandos de RacingCoach',
    de: 'RacingCoach-Befehle',
  },
  results: {
    en: 'Get your recent races and AI coaching on your results',
    pt: 'Veja suas corridas recentes e o treinamento de IA sobre seus resultados',
    es: 'Mira tus carreras recientes y el entrenamiento de IA sobre tus resultados',
    de: 'Deine letzten Rennen und KI-Coaching zu deinen Ergebnissen',
  },
  debrief: {
    en: 'See the fixes from your latest Debrief Coach session',
    pt: 'Veja as correções da sua última sessão do Debrief Coach',
    es: 'Mira las correcciones de tu última sesión de Debrief Coach',
    de: 'Die Korrekturen aus deiner letzten Debrief-Coach-Session',
  },
  recent: {
    en: 'List your recent Debrief Coach sessions',
    pt: 'Liste suas sessões recentes do Debrief Coach',
    es: 'Muestra tus sesiones recientes de Debrief Coach',
    de: 'Deine letzten Debrief-Coach-Sessions',
  },
  whoami: {
    en: 'Show which RacingCoach account your Discord account is linked to',
    pt: 'Mostra a qual conta do RacingCoach sua conta do Discord está vinculada',
    es: 'Muestra a qué cuenta de RacingCoach está vinculada tu cuenta de Discord',
    de: 'Zeigt, mit welchem RacingCoach-Konto dein Discord-Konto verknüpft ist',
  },
  status: {
    en: 'Check that RacingCoach is online',
    pt: 'Verifica se o RacingCoach está online',
    es: 'Comprueba que RacingCoach esté en línea',
    de: 'Prüft, ob RacingCoach online ist',
  },
};

// Discord's locales for the site's other languages
const localized = ({ pt, es, de }) => ({ 'pt-BR': pt, 'es-ES': es, 'es-419': es, de });

function describe(builder, name) {
  return builder.setName(name).setDescription(DESCRIPTIONS[name].en).setDescriptionLocalizations(localized(DESCRIPTIONS[name]));
}

// Everything is grouped under /coach as subcommands (/coach results, /coach debrief, ...). Discord
// doesn't allow running a command that has subcommands on its own, so plain /coach isn't available.
const commands = [
  describe(new SlashCommandBuilder(), 'coach')
    .addSubcommand((sub) => describe(sub, 'results'))
    .addSubcommand((sub) => describe(sub, 'debrief'))
    .addSubcommand((sub) => describe(sub, 'recent'))
    .addSubcommand((sub) => describe(sub, 'whoami'))
    .addSubcommand((sub) => describe(sub, 'status')),
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
