// The ElevenLabs voices (the Admin page's Eleven Labs Voice Management): npm run test:elevenlabs-voices
//
// The rules (src/lib/elevenLabsVoiceRules.ts: validation, slots, the one-time import from the environment, the names
// drivers see), then the store (src/lib/elevenLabsVoices.ts) against a disposable local Postgres, e.g.
//   docker run -d --rm --name rc-voices-test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=rctest -p 127.0.0.1:55432:5432 postgres:17
//   ELEVENLABS_VOICES_TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:55432/rctest npm run test:elevenlabs-voices
// The database part is skipped without ELEVENLABS_VOICES_TEST_DATABASE_URL. It drops and recreates the racingcoach
// schema, so it refuses any database that isn't on this computer.

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { register } from 'node:module';
import pg from 'pg';
import { elevenLabsVoiceLabel, validateVoice, voiceLanguageOf, voicesFromEnv } from '../src/lib/elevenLabsVoiceRules.ts';
import { en } from '../src/lib/i18n/dictionaries/en.ts';
import { de } from '../src/lib/i18n/dictionaries/de.ts';

const ID = 'AbCdEfGhIjKlMnOpQrSt';
const ID2 = 'ZyXwVuTsRqPoNmLkJiHg';

describe('ElevenLabs voice rules', () => {
  test('a voice is checked whole; the owner radio voice is for every language', () => {
    const ok = validateVoice({ name: ' German coach ', voiceId: ID, role: 'raceCoach', language: 'de' });
    assert.deepEqual(ok, { ok: true, voice: { name: 'German coach', voiceId: ID, role: 'raceCoach', language: 'de', enabled: true, notes: '' } });
    assert.equal(validateVoice({ name: 'Mine', voiceId: ID, role: 'ownerRadio', language: 'de' }).voice.language, 'all');
    const bad = validateVoice({ name: '', voiceId: 'no spaces!', role: 'pitCrew', language: 'xx' });
    assert.deepEqual(bad.problems, ['name', 'voiceId', 'role', 'language']);
    assert.deepEqual(validateVoice({ name: 'x', voiceId: ID, role: 'raceCoach', language: 'all' }).problems, ['language']);
  });

  test('a site language and Spanish accent find their slot', () => {
    assert.equal(voiceLanguageOf('de', 'latinAmerica'), 'de');
    assert.equal(voiceLanguageOf('es', 'latinAmerica'), 'es-latam');
    assert.equal(voiceLanguageOf('es', 'spain'), 'es-es');
  });

  test('the old environment variables are imported once into slots', () => {
    const voices = voicesFromEnv({
      ELEVENLABS_GERMAN_RACECOACH_VOICE_ID: ID,
      ELEVENLABS_ESPANA_ANNOUNCER_COLOR_VOICE_ID: ` ${ID2} `,
      ELEVENLABS_MY_VOICE_ID: ID,
      ELEVENLABS_ENGLISH_ANNOUNCER_LEAD_VOICE_ID: 'not a voice id',
    });
    assert.deepEqual(
      voices.map((v) => [v.name, v.role, v.language, v.voiceId]),
      [
        ['German Race Coach', 'raceCoach', 'de', ID],
        ['Spain Spanish Color Announcer', 'colorAnnouncer', 'es-es', ID2],
        ['Owner Driver Radio', 'ownerRadio', 'all', ID],
      ]
    );
  });

  test('drivers see a name in their own language', () => {
    assert.equal(elevenLabsVoiceLabel(en.inCarCoach, 'de', 'raceCoach'), 'Eleven Labs German Race Coach');
    assert.equal(elevenLabsVoiceLabel(en.inCarCoach, 'es-es', 'leadAnnouncer'), 'Eleven Labs Spain Spanish Lead Announcer');
    assert.equal(elevenLabsVoiceLabel(de.inCarCoach, 'de', 'raceCoach'), 'Eleven Labs Renncoach (Deutsch)');
  });
});

const url = process.env.ELEVENLABS_VOICES_TEST_DATABASE_URL;
const local = url && ['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(url).hostname);
const skip = !url ? 'ELEVENLABS_VOICES_TEST_DATABASE_URL is not set' : !local ? 'refusing a database that is not local' : false;

describe('ElevenLabs voices in the database', { skip }, () => {
  let store, users, elevenLabs, client, admin;
  const q = async (sql, params) => (await client.query(sql, params)).rows;
  const codeOf = async (promise) => {
    try {
      await promise;
      return null;
    } catch (error) {
      return error.code;
    }
  };
  const voice = (extra) => ({ name: 'Voice', voiceId: ID, role: 'raceCoach', language: 'de', enabled: true, notes: '', ...extra });

  before(async () => {
    process.env.DATABASE_URL = url;
    // The voices that used to be set in the environment, imported the first time; and a key so lookups answer
    process.env.ELEVENLABS_ITALIAN_RACECOACH_VOICE_ID = ID2;
    process.env.ELEVENLABS_API_KEY = 'test-key';
    client = new pg.Client({ connectionString: url });
    await client.connect();
    await client.query('DROP SCHEMA IF EXISTS racingcoach CASCADE');
    register(new URL('./ts-resolve-hooks.mjs', import.meta.url));
    const src = new URL('../src/lib/', import.meta.url);
    users = await import(new URL('users.ts', src).href);
    store = await import(new URL('elevenLabsVoices.ts', src).href);
    elevenLabs = await import(new URL('elevenLabs.ts', src).href);
    await users.ensureUserSchema();
    const [row] = await q(`INSERT INTO racingcoach."Users" (user_name, email_address, password, role) VALUES ('Admin', $1, 'x', 'Admin') RETURNING id`, [
      `${randomUUID()}@example.test`,
    ]);
    admin = Number(row.id);
  });
  after(async () => {
    delete process.env.ELEVENLABS_ITALIAN_RACECOACH_VOICE_ID;
    delete process.env.ELEVENLABS_API_KEY;
    await client?.end();
    await globalThis.pgPool?.end();
  });

  test('the environment\'s voices are imported the first time, and the lookups read the table', async () => {
    const listed = await store.listElevenLabsVoices();
    assert.deepEqual(
      listed.map((v) => [v.role, v.language, v.voiceId]),
      [['raceCoach', 'it', ID2]]
    );
    await store.loadElevenLabsVoices(true);
    assert.equal(elevenLabs.elevenLabsVoiceId('raceCoach', 'it'), ID2);
    assert.equal(elevenLabs.elevenLabsVoiceId('raceCoach', 'de'), null);
  });

  test('add, edit and delete: one enabled voice per role and language, and the lookups follow at once', async () => {
    const added = await store.createElevenLabsVoice(voice(), 'Hans', admin);
    assert.equal(elevenLabs.elevenLabsVoiceId('raceCoach', 'de'), ID);
    assert.equal(await codeOf(store.createElevenLabsVoice(voice({ voiceId: ID2 }), null, admin)), 'slotTaken');
    // A disabled one can wait beside it
    const spare = await store.createElevenLabsVoice(voice({ voiceId: ID2, enabled: false }), null, admin);
    await store.updateElevenLabsVoice(added.id, voice({ enabled: false }), null, admin);
    await store.updateElevenLabsVoice(spare.id, voice({ voiceId: ID2 }), null, admin);
    assert.equal(elevenLabs.elevenLabsVoiceId('raceCoach', 'de'), ID2);
    const [kept] = (await store.listElevenLabsVoices()).filter((v) => v.id === added.id);
    assert.equal(kept.elevenLabsName, 'Hans', 'the ElevenLabs name stays while the Voice ID does');
    await store.deleteElevenLabsVoice(spare.id);
    assert.equal(elevenLabs.elevenLabsVoiceId('raceCoach', 'de'), null);
    assert.equal(await codeOf(store.deleteElevenLabsVoice(spare.id)), 'notFound');
  });

  test('the owner\'s Driver Radio voice is one for every language', async () => {
    await store.createElevenLabsVoice(voice({ role: 'ownerRadio', language: 'all' }), null, admin);
    assert.equal(elevenLabs.elevenLabsRadioVoiceId(), ID);
    await assert.rejects(q(`INSERT INTO racingcoach."ElevenLabsVoices" (name, voice_id, role, language) VALUES ('x', $1, 'ownerRadio', 'de')`, [ID]));
  });

  test('a deleted imported voice doesn\'t come back', async () => {
    await q(`DELETE FROM racingcoach."ElevenLabsVoices" WHERE language = 'it'`);
    // A new server start: the schema check runs again
    const fresh = await import(new URL(`../src/lib/elevenLabsVoices.ts?again=${Date.now()}`, import.meta.url).href);
    await fresh.ensureElevenLabsVoiceSchema();
    assert.equal((await q(`SELECT 1 FROM racingcoach."ElevenLabsVoices" WHERE language = 'it'`)).length, 0);
  });
});
