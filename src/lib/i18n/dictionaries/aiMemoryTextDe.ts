import type { AiMemoryText } from './aiMemoryText';

// Die Karte KI-Gedächtnis der Kontoseite, auf Deutsch. Dieselben Schlüssel und {Platzhalter} wie aiMemoryText.ts.
export const aiMemoryDe: AiMemoryText = {
  title: 'KI-Gedächtnis',
  intro:
    'Lass die KI-Funktionen sich merken, was du ihnen erzählst, etwa deine Ziele, die Autos und Strecken, an denen du arbeitest, und wie du gecoacht werden möchtest, damit spätere Antworten darauf aufbauen können.',
  points: [
    'Deine Erinnerungen werden nur in Antworten an dich verwendet, nie für andere Nutzer.',
    'Ein RacingCoach-Administrator kann eine vorgeschlagene Erinnerung prüfen, bevor sie verwendet wird. Passwörter, Schlüssel und andere Geheimnisse werden nie gespeichert.',
    'Erinnerungen werden von KI-Modellen auf einem Computer verarbeitet, den RacingCoach betreibt.',
  ],
  toggle: 'Merken, was ich der KI erzähle',
  onSince: 'Aktiv seit {date}.',
  off: 'Aus. Nichts, was du der KI erzählst, wird gespeichert.',
  confirmOff: 'KI-Gedächtnis ausschalten? Alles, was es sich über dich gemerkt hat, wird endgültig gelöscht.',
  turnedOff: 'Das KI-Gedächtnis ist aus. {count} Erinnerungen wurden gelöscht.',
  adminPreview: 'Die Erfassung von Kundenerinnerungen ist im Memory Manager ausgeschaltet, daher sehen vorerst nur Administratoren diese Karte.',
  privacyLink: 'Wie das KI-Gedächtnis deine Daten verwendet',
  saving: 'Wird gespeichert…',
  errors: {
    logIn: 'Melde dich an, um das KI-Gedächtnis zu ändern.',
    aiFeaturesDisabled: 'Die KI-Funktionen sind auf dieser Website ausgeschaltet.',
    failed: 'Das KI-Gedächtnis konnte nicht geändert werden. Bitte versuche es erneut.',
  },
};
