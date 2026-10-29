// TV Broadcast Mode's pure parts (docs/tv-broadcast.md): pairing codes, the remote's D-pad navigation and the
// commentary queue. npm run test:tv

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  formatPairingCode,
  normalizePairingCode,
  pairingCodeFrom,
  PAIRING_ALPHABET,
  PAIRING_CODE_LENGTH,
} from '../src/lib/tvPairingCode.ts';
import { isBackKey, isPlayPauseKey, keyDirection, nextFocus } from '../src/lib/tvRemote.ts';
import { CommentaryQueue, MAX_LINE_WAIT_MS, toneWav } from '../src/lib/tvAudio.ts';

const random = () => {
  const bytes = randomBytes(64);
  let i = 0;
  return () => bytes[i++ % bytes.length];
};

describe('pairing codes', () => {
  test('codes are 8 characters of the alphabet, without look-alikes', () => {
    for (let n = 0; n < 500; n++) {
      const code = pairingCodeFrom(random());
      assert.equal(code.length, PAIRING_CODE_LENGTH);
      for (const c of code) assert.ok(PAIRING_ALPHABET.includes(c), c);
    }
    for (const lookAlike of '0O1IL2Z5SQ') assert.ok(!PAIRING_ALPHABET.includes(lookAlike), lookAlike);
  });

  test('bytes past the last whole alphabet are skipped, so each character is equally likely', () => {
    const limit = 256 - (256 % PAIRING_ALPHABET.length);
    const bytes = [255, limit, 0, 1, 2, 3, 4, 5, 6, 7];
    let i = 0;
    assert.equal(pairingCodeFrom(() => bytes[i++]), PAIRING_ALPHABET.slice(0, 8));
  });

  test('shown in two groups and typed in any form', () => {
    assert.equal(formatPairingCode('K7PR4MXT'), 'K7PR-4MXT');
    assert.equal(normalizePairingCode('k7pr-4mxt'), 'K7PR4MXT');
    assert.equal(normalizePairingCode(' K7PR 4MXT '), 'K7PR4MXT');
    assert.equal(normalizePairingCode('K7PR4MX'), null);
    assert.equal(normalizePairingCode('K7PR4MX0'), null);
    assert.equal(normalizePairingCode(''), null);
  });
});

describe('remote control', () => {
  test('D-pad keys, by name or Android key code', () => {
    assert.equal(keyDirection({ key: 'ArrowUp' }), 'up');
    assert.equal(keyDirection({ key: 'Right' }), 'right');
    assert.equal(keyDirection({ keyCode: 40 }), 'down');
    assert.equal(keyDirection({ keyCode: 21 }), 'left');
    assert.equal(keyDirection({ key: 'Enter', keyCode: 13 }), null);
    assert.ok(isBackKey({ key: 'Escape' }));
    assert.ok(isBackKey({ key: 'GoBack' }));
    assert.ok(isBackKey({ keyCode: 4 }));
    assert.ok(!isBackKey({ key: 'Backspace', keyCode: 8 }));
    assert.ok(isPlayPauseKey({ key: 'MediaPlayPause' }));
  });

  // A row of controls along the bottom and a panel's buttons above
  const box = (left, top, width = 100, height = 60) => ({ left, top, width, height });
  const row = [box(0, 1000), box(120, 1000), box(240, 1000), box(800, 1000)];

  test('moves to the nearest control that way', () => {
    assert.equal(nextFocus(row[0], row.slice(1), 'right'), 0);
    assert.equal(nextFocus(row[2], [row[0], row[1], row[3]], 'left'), 1);
    assert.equal(nextFocus(row[3], row.slice(0, 3), 'right'), -1);
  });

  test('prefers a control in line over a closer one off to the side', () => {
    const from = box(0, 500);
    const inLine = box(300, 500);
    const offAxis = box(150, 700);
    assert.equal(nextFocus(from, [offAxis, inLine], 'right'), 1);
  });

  test('up and down go between rows', () => {
    const above = [box(0, 200, 300), box(400, 200, 300)];
    assert.equal(nextFocus(box(450, 1000), above, 'up'), 1);
    assert.equal(nextFocus(box(450, 1000), above, 'down'), -1);
  });
});

describe('commentary queue', () => {
  const line = (text, speaker = 'lead') => ({ speaker, text, audio: 'AAAA' });

  test('plays lines one at a time, in order', () => {
    const queue = new CommentaryQueue();
    queue.push([line('One'), line('Two', 'color')], 0);
    queue.push([line('Three')], 10);
    assert.deepEqual([queue.next(20)?.text, queue.next(30)?.text, queue.next(40)?.text, queue.next(50)], ['One', 'Two', 'Three', null]);
  });

  test('drops lines that waited too long', () => {
    const queue = new CommentaryQueue();
    queue.push([line('Old')], 0);
    queue.push([line('New')], MAX_LINE_WAIT_MS);
    assert.equal(queue.next(MAX_LINE_WAIT_MS + 1)?.text, 'New');
  });

  test('never plays the same words twice in a row, as after a reconnect', () => {
    const queue = new CommentaryQueue();
    queue.push([line('Into the lead!'), line('Into the lead!')], 0);
    assert.equal(queue.size, 1);
    assert.equal(queue.next(1)?.text, 'Into the lead!');
    queue.push([line('Into the lead!'), line('Fastest lap.')], 2);
    assert.equal(queue.next(3)?.text, 'Fastest lap.');
    assert.equal(queue.next(4), null);
  });

  test('clear empties it', () => {
    const queue = new CommentaryQueue();
    queue.push([line('A'), line('B')], 0);
    queue.clear();
    assert.equal(queue.next(1), null);
  });

  test('the test tone is a valid 16-bit mono WAV, silent at volume 0', () => {
    const wav = toneWav(440, 100, 0.3, 8000);
    const view = new DataView(wav.buffer);
    assert.equal(String.fromCharCode(...wav.slice(0, 4)), 'RIFF');
    assert.equal(String.fromCharCode(...wav.slice(8, 12)), 'WAVE');
    assert.equal(view.getUint16(22, true), 1);
    assert.equal(view.getUint32(40, true), 800 * 2);
    assert.equal(wav.length, 44 + 1600);
    const silent = toneWav(440, 100, 0, 8000);
    assert.ok(silent.slice(44).every((b) => b === 0));
  });
});
