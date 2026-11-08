// The check that AI answers for users of another language have no English words in them
// (src/lib/i18n/englishWords.ts, used by src/lib/answerChecks.ts): npm run test:language

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { englishWords, hasEnglish } from '../src/lib/i18n/englishWords.ts';

// Answers fully in their language: nothing to rewrite
const clean = {
  es: [
    'Frena unos 6 m más tarde que en tu vuelta más rápida y suelta el freno de forma progresiva.',
    'En la Vuelta 6 perdiste dos décimas en la salida de curva; vuelve al acelerador antes.',
    'No tires del volante en la entrada: mantén la presión de freno en el vértice.',
    'Has mejorado: tu mejor vuelta es 1:42.318, he visto que frenas más tarde.',
  ],
  pt: [
    'Freie uns 6 m mais tarde que na sua volta mais rápida e tire o pé do acelerador mais cedo.',
    'Se for possível, faça a tangência mais aberta; o seu time de equipe está atento.',
    'Na Volta 6 você perdeu dois décimos na saída de curva.',
  ],
  de: [
    'Brems etwa 6 m später als in deiner schnellsten Runde und geh früher ans Gas.',
    'Du bist fast so schnell wie in der Zielrunde, aber am Scheitelpunkt noch zu langsam.',
    'Was du willst: Position halten, also nicht zu spät bremsen. Das war die Last am Ende des Stints.',
  ],
};

for (const [language, answers] of Object.entries(clean)) {
  for (const answer of answers) {
    test(`no English in a ${language} answer: ${answer}`, () => {
      assert.deepEqual(englishWords(answer, language), []);
    });
  }
}

// English that slipped in
const leaks = [
  ['es', 'Frena 6 m más tarde que tu fastest lap.', ['fastest', 'lap']],
  ['es', 'Vuelta 3: keep the throttle más tiempo.', ['keep', 'the', 'throttle']],
  ['es', 'Tu brakepoint fue 10 m later que en la Target Lap.', ['brakepoint', 'later', 'target', 'lap']],
  ['pt', 'Você está ganhando tempo na exit da curva.', ['exit']],
  ['pt', 'Freie mais tarde, you can do it!', ['you', 'can', 'it']],
  ['de', 'Brems später, the apex ist zu früh.', ['the', 'apex']],
  ['de', "Gut gemacht, don't stop!", ["don't"]],
];

for (const [language, answer, words] of leaks) {
  test(`English found in a ${language} answer: ${answer}`, () => {
    assert.deepEqual(englishWords(answer, language), words);
    assert.equal(hasEnglish(answer, language), true);
  });
}

test('names from the data are kept as they are', () => {
  const names = ['Circuit of the Americas', 'NASCAR Cup Series Next Gen', 'Turn 1', 'Will Power'];
  const answer = 'En Circuit of the Americas con el NASCAR Cup Series Next Gen, frena antes en Turn 1. Will Power te alcanza.';
  assert.deepEqual(englishWords(answer, 'es', names), []);
  // without the names, they count
  assert.ok(englishWords(answer, 'es').includes('the'));
});

test('a name is only taken out as a whole word', () => {
  assert.deepEqual(englishWords('Frena antes en Spa, the curva es rápida.', 'es', ['Spa']), ['the']);
});

test('placeholders and the site’s own names are left out', () => {
  assert.deepEqual(englishWords('Vuelta {lap}: {lapTime} ({delta})', 'es'), []);
  assert.deepEqual(englishWords('Abre RacingCoach.app y sube la vuelta de iRacing o de Garage 61.', 'es'), []);
});

test('English answers are never checked', () => {
  assert.deepEqual(englishWords('Brake 6 ft later than your fastest lap.', 'en'), []);
});

test('each word once, in the order it appears', () => {
  assert.deepEqual(englishWords('the lap, the lap and the lap', 'de'), ['the', 'lap', 'and']);
});
