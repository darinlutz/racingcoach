import type { AiMemoryText } from './aiMemoryText';

// O cartão Memória da IA da página da conta, em português. Mesmas chaves e {marcadores} que aiMemoryText.ts.
export const aiMemoryPt: AiMemoryText = {
  title: 'Memória da IA',
  intro:
    'Deixe os recursos de IA lembrarem o que você conta a eles, como seus objetivos, os carros e pistas em que está trabalhando e como prefere ser treinado, para que as respostas seguintes possam usar isso.',
  points: [
    'Suas memórias são usadas apenas nas respostas para você, nunca para outros usuários.',
    'Um administrador do RacingCoach pode revisar uma memória proposta antes de ela ser usada. Senhas, chaves e outros segredos nunca são salvos.',
    'As memórias são processadas por modelos de IA em um computador operado pelo RacingCoach.',
  ],
  toggle: 'Lembrar o que eu conto à IA',
  onSince: 'Ativada desde {date}.',
  off: 'Desativada. Nada do que você conta à IA é lembrado.',
  confirmOff: 'Desativar a Memória da IA? Tudo o que ela lembra sobre você será excluído permanentemente.',
  turnedOff: 'A Memória da IA está desativada. {count} memórias foram excluídas.',
  adminPreview: 'A captura de memória de clientes está desativada no Memory Manager, então por enquanto só os administradores veem este cartão.',
  privacyLink: 'Como a Memória da IA usa suas informações',
  saving: 'Salvando…',
  errors: {
    logIn: 'Entre para alterar a Memória da IA.',
    aiFeaturesDisabled: 'Os recursos de IA estão desativados neste site.',
    failed: 'Não foi possível alterar a Memória da IA. Tente novamente.',
  },
};
