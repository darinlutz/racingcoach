import type { AiMemoryText } from './aiMemoryText';

// La tarjeta Memoria de la IA de la página de la cuenta, en español. Mismas claves y {marcadores} que aiMemoryText.ts.
export const aiMemoryEs: AiMemoryText = {
  title: 'Memoria de la IA',
  intro:
    'Deja que las funciones de IA recuerden lo que les cuentas, como tus objetivos, los autos y circuitos en los que estás trabajando y cómo prefieres que te entrenen, para que las respuestas siguientes puedan usarlo.',
  points: [
    'Tus memorias se usan solo en las respuestas para ti, nunca para otros usuarios.',
    'Un administrador de RacingCoach puede revisar una memoria propuesta antes de que se use. Nunca se guardan contraseñas, claves ni otros secretos.',
    'Las memorias se procesan con modelos de IA en una computadora que opera RacingCoach.',
  ],
  toggle: 'Recordar lo que le cuento a la IA',
  onSince: 'Activada desde el {date}.',
  off: 'Desactivada. No se recuerda nada de lo que le cuentas a la IA.',
  confirmOff: '¿Desactivar la Memoria de la IA? Todo lo que recuerda sobre ti se eliminará de forma permanente.',
  turnedOff: 'La Memoria de la IA está desactivada. Se eliminaron {count} memorias.',
  adminPreview: 'La captura de memoria de clientes está desactivada en el Memory Manager, así que por ahora solo los administradores ven esta tarjeta.',
  privacyLink: 'Cómo usa tu información la Memoria de la IA',
  saving: 'Guardando…',
  errors: {
    logIn: 'Inicia sesión para cambiar la Memoria de la IA.',
    aiFeaturesDisabled: 'Las funciones de IA están desactivadas en este sitio.',
    failed: 'No se pudo cambiar la Memoria de la IA. Inténtalo de nuevo.',
  },
};
