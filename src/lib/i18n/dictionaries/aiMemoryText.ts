// The Account page's AI Memory card (src/components/AiMemoryCard.tsx) and PUT /api/account/ai-memory's errors, in
// English. The other languages are in aiMemoryText<Lang>.ts with the same keys and {placeholders}.
export const aiMemoryEn = {
  title: 'AI Memory',
  intro:
    'Let the AI features remember things you tell them, such as your goals, the cars and tracks you are working on and how you like to be coached, so later answers can use them.',
  points: [
    'Your memories are used only in answers to you, never for other users.',
    'A RacingCoach administrator may review a proposed memory before it is used. Passwords, keys and other secrets are never saved.',
    'Memories are processed by AI models on a computer RacingCoach runs.',
  ],
  toggle: 'Remember what I tell the AI',
  onSince: 'On since {date}.',
  off: 'Off. Nothing you tell the AI is remembered.',
  confirmOff: 'Turn off AI Memory? Everything it remembers about you will be deleted permanently.',
  turnedOff: 'AI Memory is off. {count} memories were deleted.',
  adminPreview: 'Customer memory capture is off in the Memory Manager, so only Admins see this card for now.',
  privacyLink: 'How AI Memory uses your information',
  saving: 'Saving…',
  errors: {
    logIn: 'Log in to change AI Memory.',
    aiFeaturesDisabled: 'AI features are turned off on this site.',
    failed: 'AI Memory could not be changed. Please try again.',
  },
};

export type AiMemoryText = typeof aiMemoryEn;
