import type { AiMemoryText } from './aiMemoryText';

// La carte Mémoire de l’IA de la page du compte, en français. Mêmes clés et {marqueurs} que aiMemoryText.ts.
export const aiMemoryFr: AiMemoryText = {
  title: 'Mémoire de l’IA',
  intro:
    'Laissez les fonctions d’IA retenir ce que vous leur dites, comme vos objectifs, les voitures et circuits sur lesquels vous travaillez et la façon dont vous aimez être coaché, pour que les réponses suivantes puissent s’en servir.',
  points: [
    'Vos souvenirs ne servent qu’aux réponses qui vous sont destinées, jamais à d’autres utilisateurs.',
    'Un administrateur de RacingCoach peut examiner un souvenir proposé avant son utilisation. Les mots de passe, clés et autres secrets ne sont jamais enregistrés.',
    'Les souvenirs sont traités par des modèles d’IA sur un ordinateur exploité par RacingCoach.',
  ],
  toggle: 'Retenir ce que je dis à l’IA',
  onSince: 'Activée depuis le {date}.',
  off: 'Désactivée. Rien de ce que vous dites à l’IA n’est retenu.',
  confirmOff: 'Désactiver la Mémoire de l’IA ? Tout ce qu’elle a retenu sur vous sera supprimé définitivement.',
  turnedOff: 'La Mémoire de l’IA est désactivée. {count} souvenirs ont été supprimés.',
  adminPreview: 'La capture de mémoire des clients est désactivée dans le Memory Manager : pour l’instant, seuls les administrateurs voient cette carte.',
  privacyLink: 'Comment la Mémoire de l’IA utilise vos informations',
  saving: 'Enregistrement…',
  errors: {
    logIn: 'Connectez-vous pour modifier la Mémoire de l’IA.',
    aiFeaturesDisabled: 'Les fonctions d’IA sont désactivées sur ce site.',
    failed: 'Impossible de modifier la Mémoire de l’IA. Veuillez réessayer.',
  },
};
