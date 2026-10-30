// Track position checks for the AI coaches' answers (src/lib/trackPositions.ts): npm run test:track-positions

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasTrackPosition, removeTrackPositions, trackPositionSentences } from '../src/lib/trackPositions.ts';

const positions = [
  'Brake at 6120 ft.',
  'Brake near 375 meters.',
  'Hold the T20 brake release smooth: your best lap is off the brake by 17221 ft.',
  'Your best lap released the brake at 4,350 ft and picked up the throttle at 4,520 ft.',
  'You get back to the throttle at 980 ft.',
  'Brake 400 ft after the start/finish line.',
  'Turn in at 45% of the lap.',
  'Your brakepoint averages 1,234 ft with a std dev of 22 ft.',
  'Freie a 1.865 m.',
  'Frena en 1865 metros.',
  'Brems bei 1.865 m.',
  'Brems bei 1865 Metern.',
  'Der Bremspunkt liegt 400 ft nach der Start-Ziel-Linie.',
  'Lenke bei 45 % der Runde ein.',
  'The Target Lap brakes at 2,340 ft.',
];

const relative = [
  'Brake about 20 ft later.',
  'Brake 10 ft earlier than your fastest lap.',
  'Your fastest runs braked 30 ft LATER than your slowest.',
  'Release the brake 10 m earlier.',
  'Throttle on 30 ft after the Target Lap does.',
  'Your brakepoint varies by 25 ft from lap to lap.',
  'Your brakepoints are within 3 m of each other.',
  'Brakepoint std dev 22 ft.',
  'Lock down a consistent braking reference to cut the ~14 ft scatter.',
  'Move the car about 2 ft to the left at the exit.',
  'Place the car 0.6 m to the right at turn-in.',
  'You braked 15 ft after the reference brakepoint.',
  'Your slowest lap released the brake 40 ft before your fastest.',
  'Freie uns 30 ft mais tarde.',
  'Frena 6 m más tarde.',
  'Brems etwa 30 ft später.',
  'Brems 6 m früher als in deiner schnellsten Runde.',
  'Dein Bremspunkt schwankt um 25 ft von Runde zu Runde.',
  'Deine Bremspunkte liegen innerhalb von 3 m.',
  'Du hast 15 ft nach dem Referenz-Bremspunkt gebremst.',
  'Setze das Auto am Ausgang etwa 2 ft weiter links.',
  'Hold 3rd gear until 7,800 rpm.',
  'Build to about 90% peak pressure.',
  'Your theoretical lap is 0.438s faster than your best.',
];

test('flags places on the track', () => {
  for (const text of positions) assert.equal(hasTrackPosition(text), true, text);
});

test('allows changes, reference points and spreads', () => {
  for (const text of relative) assert.equal(hasTrackPosition(text), false, text);
});

test('removes only the sentences with places on the track', () => {
  const text = 'Brake 20 ft later in T1. Your best lap is off the brake by 17221 ft. Keep your exit speed.\nGood work.';
  assert.deepEqual(trackPositionSentences(text), ['Your best lap is off the brake by 17221 ft.']);
  assert.equal(removeTrackPositions(text), 'Brake 20 ft later in T1. Keep your exit speed.\nGood work.');
});
