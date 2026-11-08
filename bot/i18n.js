// Every reply the bot writes, in the driver's Preferred Language on the website (racingcoach."Users".preferred_language,
// read by getLinkedUser in db.js): English, Brazilian Portuguese, Latin American Spanish or German, in the website's
// words (src/lib/i18n/dictionaries, which the bot can't import). Before an account is linked, Discord's own language
// for the user picks it (interaction.locale). Track, car and focus area names stay as they are; the AI's texts come
// from the website already in the driver's language.

export const LANGUAGES = ['en', 'pt', 'es', 'de'];

const LOCALES = { en: 'en-US', pt: 'pt-BR', es: 'es-419', de: 'de-DE' };

// The language for a reply: the linked account's, else Discord's (e.g. "es-ES", "pt-BR", "de"), else English
export function languageFor(user, discordLocale) {
  if (user && LANGUAGES.includes(user.language)) return user.language;
  const code = String(discordLocale ?? '').toLowerCase().split('-')[0];
  return LANGUAGES.includes(code) ? code : 'en';
}

export const localeOf = (language) => LOCALES[language] ?? LOCALES.en;

// "{n} laps" + { n: 3 } -> "3 laps"
export function fmt(template, values = {}) {
  return template.replace(/\{(\w+)\}/g, (match, key) => (key in values ? String(values[key]) : match));
}

const TEXTS = {
  en: {
    online: 'RacingCoach is online! Your racing coach is ready.',
    somethingWrong: 'Something went wrong running that command.',
    accountPage: 'the RacingCoach Account page',
    pricingPage: 'the RacingCoach Pricing page',
    raceTrendsPage: 'the My Race Trends page',
    racingPage: 'the My Sessions page',
    notLinked: "Your Discord account isn't linked to RacingCoach yet. Sign in and click **Connect Discord** on {page}.",
    upgrade: "`{command}` uses AI coaching, which isn't included with a Bronze membership. To use it, upgrade to Silver or Gold on {page}.",
    member: '{level} Member',
    memberSince: '{level} Member since {since}',
    linked: "You're linked to the RacingCoach account **{name}**, {membership}.",
    adminsOnly: '`/coach results` is only available to RacingCoach Admins.',
    noRaces: 'No races found for **{name}** yet. Connect iRacePlan and load your races on {page}.',
    noDebriefs: 'No debriefs saved for **{name}** yet. Sign in, run **Debrief Coach** on {page}, then try again.',
    // /coach results
    racingAnalysis: '🏁 Your Racing Analysis',
    bestLap: 'Best lap',
    avgVsBest: 'Avg vs best lap',
    iRatingLast: 'iRating · last {n}',
    lastFinishes: 'Last {n} finishes (newest first)',
    dnf: 'DNF',
    raceFooter: 'RacingCoach.app · AI-powered race analysis',
    coachingUnavailable: '⚠️ Coaching unavailable',
    outOfCredits: 'The AI service is out of credits.',
    coachingFailed: "The AI coach couldn't analyze your races right now. Please try again in a few minutes.",
    analyzing: '⏳ Analyzing your races…',
    analyzingCopy: 'Your coach is reviewing all of your races. This can take up to a minute.',
    topThree: 'Your top 3 opportunities',
    // /coach debrief
    sessionDebrief: '🏁 Your Session Debrief',
    lapsAnalyzed: '{n} laps analyzed {when}',
    potentialGain: 'Potential gain',
    topOne: 'Your top opportunity',
    topN: 'Your top {n} opportunities',
    keepDoing: '✅ Keep doing',
    debriefFooter: 'RacingCoach.app · AI-powered driving analysis',
    seconds: '{n} sec',
    turn: 'Turn {n}',
    turnsAnd: 'Turns {a} & {b}',
    turnsRange: 'Turns {a}–{b}',
    // /coach recent
    recentSessions: '🏁 Your Recent Sessions',
    lastSessionsOne: 'Your last Debrief Coach session',
    lastSessions: 'Your last {n} Debrief Coach sessions, newest first',
    recentLine: 'Best lap **{best}** · {laps} laps · −{gain} sec potential · {when}',
    recentFooter: 'RacingCoach.app · Run /coach debrief for your latest fixes',
    focus: {
      Braking: 'Braking', 'Brake pressure': 'Brake pressure', 'Trail braking': 'Trail braking', Throttle: 'Throttle',
      Shifting: 'Shifting', Steering: 'Steering', 'Driving line': 'Driving line', 'Mid-corner speed': 'Mid-corner speed',
      'Corner exit': 'Corner exit', Consistency: 'Consistency', Incidents: 'Incidents', Racecraft: 'Racecraft',
      Qualifying: 'Qualifying', 'Track choice': 'Track choice', 'Car choice': 'Car choice',
    },
  },
  pt: {
    online: 'O RacingCoach está online! Seu treinador de corrida está pronto.',
    somethingWrong: 'Algo deu errado ao executar esse comando.',
    accountPage: 'a página Minhas configurações do RacingCoach',
    pricingPage: 'a página Preços do RacingCoach',
    raceTrendsPage: 'a página Minhas tendências',
    racingPage: 'a página Minhas sessões',
    notLinked: 'Sua conta do Discord ainda não está vinculada ao RacingCoach. Entre e clique em **Conectar Discord** em {page}.',
    upgrade: '`{command}` usa o treinador de IA, que não está incluído na assinatura Bronze. Para usá-lo, mude para Silver ou Gold em {page}.',
    member: 'Membro {level}',
    memberSince: 'Membro {level} desde {since}',
    linked: 'Você está vinculado à conta do RacingCoach **{name}**, {membership}.',
    adminsOnly: '`/coach results` está disponível apenas para administradores do RacingCoach.',
    noRaces: 'Nenhuma corrida encontrada para **{name}** ainda. Conecte o iRacePlan e carregue suas corridas em {page}.',
    noDebriefs: 'Nenhum debrief salvo para **{name}** ainda. Entre, execute o **Debrief Coach** em {page} e tente de novo.',
    racingAnalysis: '🏁 Sua análise de corridas',
    bestLap: 'Melhor volta',
    avgVsBest: 'Média x melhor volta',
    iRatingLast: 'iRating · últimas {n}',
    lastFinishes: 'Últimas {n} chegadas (mais recentes primeiro)',
    dnf: 'Não terminou',
    raceFooter: 'RacingCoach.app · Análise de corridas com IA',
    coachingUnavailable: '⚠️ Treinamento indisponível',
    outOfCredits: 'O serviço de IA está sem créditos.',
    coachingFailed: 'O treinador de IA não conseguiu analisar suas corridas agora. Tente de novo em alguns minutos.',
    analyzing: '⏳ Analisando suas corridas…',
    analyzingCopy: 'Seu treinador está revisando todas as suas corridas. Isso pode levar até um minuto.',
    topThree: 'Suas 3 maiores oportunidades',
    sessionDebrief: '🏁 Debrief da sua sessão',
    lapsAnalyzed: '{n} voltas analisadas {when}',
    potentialGain: 'Ganho possível',
    topOne: 'Sua maior oportunidade',
    topN: 'Suas {n} maiores oportunidades',
    keepDoing: '✅ Continue fazendo',
    debriefFooter: 'RacingCoach.app · Análise de pilotagem com IA',
    seconds: '{n} s',
    turn: 'Curva {n}',
    turnsAnd: 'Curvas {a} e {b}',
    turnsRange: 'Curvas {a}–{b}',
    recentSessions: '🏁 Suas sessões recentes',
    lastSessionsOne: 'Sua última sessão do Debrief Coach',
    lastSessions: 'Suas últimas {n} sessões do Debrief Coach, mais recentes primeiro',
    recentLine: 'Melhor volta **{best}** · {laps} voltas · −{gain} s possíveis · {when}',
    recentFooter: 'RacingCoach.app · Use /coach debrief para ver suas correções mais recentes',
    focus: {
      Braking: 'Frenagem', 'Brake pressure': 'Pressão de freio', 'Trail braking': 'Frenagem em degradê', Throttle: 'Acelerador',
      Shifting: 'Troca de marchas', Steering: 'Direção', 'Driving line': 'Traçado', 'Mid-corner speed': 'Velocidade no meio da curva',
      'Corner exit': 'Saída de curva', Consistency: 'Consistência', Incidents: 'Incidentes', Racecraft: 'Disputa de posição',
      Qualifying: 'Classificação', 'Track choice': 'Escolha de pista', 'Car choice': 'Escolha de carro',
    },
  },
  es: {
    online: '¡RacingCoach está en línea! Tu entrenador de carreras está listo.',
    somethingWrong: 'Algo salió mal al ejecutar ese comando.',
    accountPage: 'la página Mi configuración de RacingCoach',
    pricingPage: 'la página Precios de RacingCoach',
    raceTrendsPage: 'la página Mis tendencias',
    racingPage: 'la página Mis sesiones',
    notLinked: 'Tu cuenta de Discord todavía no está vinculada a RacingCoach. Inicia sesión y haz clic en **Conectar Discord** en {page}.',
    upgrade: '`{command}` usa el entrenador de IA, que no está incluido en la membresía Bronze. Para usarlo, pásate a Silver o Gold en {page}.',
    member: 'Miembro {level}',
    memberSince: 'Miembro {level} desde {since}',
    linked: 'Estás vinculado a la cuenta de RacingCoach **{name}**, {membership}.',
    adminsOnly: '`/coach results` solo está disponible para los administradores de RacingCoach.',
    noRaces: 'Todavía no hay carreras de **{name}**. Conecta iRacePlan y carga tus carreras en {page}.',
    noDebriefs: 'Todavía no hay debriefs guardados de **{name}**. Inicia sesión, ejecuta **Debrief Coach** en {page} y vuelve a intentarlo.',
    racingAnalysis: '🏁 Tu análisis de carreras',
    bestLap: 'Mejor vuelta',
    avgVsBest: 'Promedio vs. mejor vuelta',
    iRatingLast: 'iRating · últimas {n}',
    lastFinishes: 'Últimos {n} resultados (los más recientes primero)',
    dnf: 'No terminó',
    raceFooter: 'RacingCoach.app · Análisis de carreras con IA',
    coachingUnavailable: '⚠️ Entrenamiento no disponible',
    outOfCredits: 'El servicio de IA se quedó sin créditos.',
    coachingFailed: 'El entrenador de IA no pudo analizar tus carreras ahora. Vuelve a intentarlo en unos minutos.',
    analyzing: '⏳ Analizando tus carreras…',
    analyzingCopy: 'Tu entrenador está revisando todas tus carreras. Esto puede tardar hasta un minuto.',
    topThree: 'Tus 3 mejores oportunidades',
    sessionDebrief: '🏁 Debrief de tu sesión',
    lapsAnalyzed: '{n} vueltas analizadas {when}',
    potentialGain: 'Ganancia posible',
    topOne: 'Tu mejor oportunidad',
    topN: 'Tus {n} mejores oportunidades',
    keepDoing: '✅ Sigue haciendo',
    debriefFooter: 'RacingCoach.app · Análisis de manejo con IA',
    seconds: '{n} s',
    turn: 'Curva {n}',
    turnsAnd: 'Curvas {a} y {b}',
    turnsRange: 'Curvas {a}–{b}',
    recentSessions: '🏁 Tus sesiones recientes',
    lastSessionsOne: 'Tu última sesión de Debrief Coach',
    lastSessions: 'Tus últimas {n} sesiones de Debrief Coach, las más recientes primero',
    recentLine: 'Mejor vuelta **{best}** · {laps} vueltas · −{gain} s posibles · {when}',
    recentFooter: 'RacingCoach.app · Usa /coach debrief para ver tus correcciones más recientes',
    focus: {
      Braking: 'Frenada', 'Brake pressure': 'Presión de freno', 'Trail braking': 'Frenada degresiva', Throttle: 'Acelerador',
      Shifting: 'Cambios de marcha', Steering: 'Dirección', 'Driving line': 'Trazada', 'Mid-corner speed': 'Velocidad en el medio de la curva',
      'Corner exit': 'Salida de curva', Consistency: 'Consistencia', Incidents: 'Incidentes', Racecraft: 'Lucha en pista',
      Qualifying: 'Clasificación', 'Track choice': 'Elección de pista', 'Car choice': 'Elección de auto',
    },
  },
  de: {
    online: 'RacingCoach ist online! Dein Renncoach ist bereit.',
    somethingWrong: 'Beim Ausführen dieses Befehls ist etwas schiefgelaufen.',
    accountPage: 'der Seite „Meine Einstellungen“ von RacingCoach',
    pricingPage: 'der Seite „Preise“ von RacingCoach',
    raceTrendsPage: 'der Seite „Meine Renntrends“',
    racingPage: 'der Seite „Meine Sessions“',
    notLinked: 'Dein Discord-Konto ist noch nicht mit RacingCoach verknüpft. Melde dich an und klicke auf **Discord verbinden** auf {page}.',
    upgrade: '`{command}` nutzt den KI-Coach, der in der Bronze-Mitgliedschaft nicht enthalten ist. Wechsle dafür zu Silver oder Gold auf {page}.',
    member: '{level}-Mitglied',
    memberSince: '{level}-Mitglied seit {since}',
    linked: 'Du bist mit dem RacingCoach-Konto **{name}** verknüpft, {membership}.',
    adminsOnly: '`/coach results` ist nur für RacingCoach-Administratoren verfügbar.',
    noRaces: 'Noch keine Rennen für **{name}** gefunden. Verbinde iRacePlan und lade deine Rennen auf {page}.',
    noDebriefs: 'Noch keine gespeicherten Debriefs für **{name}**. Melde dich an, starte **Debrief Coach** auf {page} und versuche es dann erneut.',
    racingAnalysis: '🏁 Deine Rennanalyse',
    bestLap: 'Beste Runde',
    avgVsBest: 'Schnitt vs. beste Runde',
    iRatingLast: 'iRating · letzte {n}',
    lastFinishes: 'Letzte {n} Ergebnisse (neueste zuerst)',
    dnf: 'Nicht beendet',
    raceFooter: 'RacingCoach.app · Rennanalyse mit KI',
    coachingUnavailable: '⚠️ Coaching nicht verfügbar',
    outOfCredits: 'Der KI-Dienst hat kein Guthaben mehr.',
    coachingFailed: 'Der KI-Coach konnte deine Rennen gerade nicht analysieren. Versuche es in ein paar Minuten erneut.',
    analyzing: '⏳ Deine Rennen werden analysiert…',
    analyzingCopy: 'Dein Coach sieht sich alle deine Rennen an. Das kann bis zu einer Minute dauern.',
    topThree: 'Deine 3 größten Chancen',
    sessionDebrief: '🏁 Dein Session-Debrief',
    lapsAnalyzed: '{n} Runden analysiert {when}',
    potentialGain: 'Möglicher Gewinn',
    topOne: 'Deine größte Chance',
    topN: 'Deine {n} größten Chancen',
    keepDoing: '✅ Weiter so',
    debriefFooter: 'RacingCoach.app · Fahranalyse mit KI',
    seconds: '{n} s',
    turn: 'Kurve {n}',
    turnsAnd: 'Kurven {a} und {b}',
    turnsRange: 'Kurven {a}–{b}',
    recentSessions: '🏁 Deine letzten Sessions',
    lastSessionsOne: 'Deine letzte Debrief-Coach-Session',
    lastSessions: 'Deine letzten {n} Debrief-Coach-Sessions, neueste zuerst',
    recentLine: 'Beste Runde **{best}** · {laps} Runden · −{gain} s möglich · {when}',
    recentFooter: 'RacingCoach.app · Mit /coach debrief siehst du deine neuesten Korrekturen',
    focus: {
      Braking: 'Bremsen', 'Brake pressure': 'Bremsdruck', 'Trail braking': 'Bremsen in die Kurve hinein', Throttle: 'Gas',
      Shifting: 'Schalten', Steering: 'Lenkung', 'Driving line': 'Linie', 'Mid-corner speed': 'Kurvenmittengeschwindigkeit',
      'Corner exit': 'Kurvenausgang', Consistency: 'Konstanz', Incidents: 'Incidents', Racecraft: 'Zweikampf',
      Qualifying: 'Qualifying', 'Track choice': 'Streckenwahl', 'Car choice': 'Autowahl',
    },
  },
};

// The texts for a language
export function textsFor(language) {
  return TEXTS[language] ?? TEXTS.en;
}

// A debrief or coaching focus (the website's English labels, e.g. "Brake pressure") in the language
export function focusLabel(language, focus) {
  return focus ? (textsFor(language).focus[focus] ?? focus) : null;
}

// A number with the language's decimal separator, e.g. 0.2 -> "0,20" in Portuguese
export function decimal(language, value, digits = 2) {
  return value.toLocaleString(localeOf(language), { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
