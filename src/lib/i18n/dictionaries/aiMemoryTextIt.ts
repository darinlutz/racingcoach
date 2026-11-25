import type { AiMemoryText } from './aiMemoryText';

// La scheda Memoria dell’IA della pagina dell’account, in italiano. Stesse chiavi e {segnaposto} di aiMemoryText.ts.
export const aiMemoryIt: AiMemoryText = {
  title: 'Memoria dell’IA',
  intro:
    'Lascia che le funzioni di IA ricordino ciò che racconti loro, come i tuoi obiettivi, le auto e i circuiti su cui stai lavorando e come preferisci essere allenato, così le risposte successive potranno usarlo.',
  points: [
    'I tuoi ricordi vengono usati solo nelle risposte a te, mai per altri utenti.',
    'Un amministratore di RacingCoach può esaminare un ricordo proposto prima che venga usato. Password, chiavi e altri segreti non vengono mai salvati.',
    'I ricordi vengono elaborati da modelli di IA su un computer gestito da RacingCoach.',
  ],
  toggle: 'Ricorda ciò che dico all’IA',
  onSince: 'Attiva dal {date}.',
  off: 'Disattivata. Nulla di ciò che dici all’IA viene ricordato.',
  confirmOff: 'Disattivare la Memoria dell’IA? Tutto ciò che ricorda di te verrà eliminato definitivamente.',
  turnedOff: 'La Memoria dell’IA è disattivata. Sono stati eliminati {count} ricordi.',
  adminPreview: 'La raccolta della memoria dei clienti è disattivata nel Memory Manager, quindi per ora solo gli amministratori vedono questa scheda.',
  privacyLink: 'Come la Memoria dell’IA usa le tue informazioni',
  saving: 'Salvataggio…',
  errors: {
    logIn: 'Accedi per modificare la Memoria dell’IA.',
    aiFeaturesDisabled: 'Le funzioni di IA sono disattivate su questo sito.',
    failed: 'Impossibile modificare la Memoria dell’IA. Riprova.',
  },
};
