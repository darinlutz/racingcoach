// The Setups page's data against a real database: npm run test:setups
//
// Runs src/lib/setups.ts against a disposable local Postgres, e.g.
//   docker run -d --rm --name rc-setups-test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=rctest -p 127.0.0.1:55432:5432 postgres:17
//   SETUPS_TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:55432/rctest npm run test:setups
// Skipped without SETUPS_TEST_DATABASE_URL. It drops and recreates the racingcoach schema, so it refuses any database
// that isn't on this computer.

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { register } from 'node:module';
import { gzipSync } from 'node:zlib';
import pg from 'pg';

const url = process.env.SETUPS_TEST_DATABASE_URL;
const local = url && ['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(url).hostname);
const skip = !url ? 'SETUPS_TEST_DATABASE_URL is not set' : !local ? 'refusing a database that is not local' : false;

const fixture = fs.readFileSync(new URL('./fixtures/setups/bmwm4gt3-fixed-carsetup.yaml', import.meta.url), 'utf8');
let setups, users, laps, erasure, client;
const q = async (sql, params) => (await client.query(sql, params)).rows;

async function makeUser() {
  const [row] = await q(
    `INSERT INTO racingcoach."Users" (user_name, email_address, password, membership_level) VALUES ('Test Driver', $1, 'x', 'Gold') RETURNING id`,
    [`${randomUUID()}@example.test`]
  );
  return Number(row.id);
}

const capture = (overrides = {}) => ({
  simulator: 'iracing',
  car: 'BMW M4 GT3 EVO',
  carKey: 'bmwm4gt3',
  track: 'Mobility Resort Motegi (Full Road Course)',
  trackKey: 'twinring fullrc',
  setupName: 'fixed.sto',
  loadType: 'iracing',
  modified: false,
  passedTech: 1,
  fixedSession: false,
  sessionId: 10,
  subSessionId: 20,
  observedAt: new Date(Date.now() - 10 * 60 * 1000),
  yaml: fixture,
  ...overrides,
});

// A file in iRacing's layout (scripts/setups.test.mjs builds the same)
function sto(seed = 0xab) {
  const text = Buffer.from('Notes\u0000', 'utf16le');
  const header = Buffer.alloc(16);
  header.writeUInt32LE(3, 0);
  header.writeUInt32LE(8 + 32 + 32 + text.length, 4);
  header.writeUInt32LE(32, 8);
  header.writeUInt32LE(text.length, 12);
  return Buffer.concat([header, Buffer.alloc(32, seed), Buffer.alloc(32, 0xcd), text, Buffer.alloc(8)]);
}

describe('Setups data', { skip }, () => {
  before(async () => {
    process.env.DATABASE_URL = url;
    client = new pg.Client({ connectionString: url });
    await client.connect();
    await client.query('DROP SCHEMA IF EXISTS racingcoach CASCADE');
    register(new URL('./ts-resolve-hooks.mjs', import.meta.url));
    const src = new URL('../src/lib/', import.meta.url);
    users = await import(new URL('users.ts', src).href);
    setups = await import(new URL('setups.ts', src).href);
    laps = await import(new URL('collectorLaps.ts', src).href);
    erasure = await import(new URL('dataErasure.ts', src).href);
    await users.ensureUserSchema();
  });
  after(async () => {
    await client?.end();
    await globalThis.pgPool?.end();
  });

  test('a capture makes a setup, a revision with every value and an inspection', async () => {
    const user = await makeUser();
    const result = await setups.recordCapture(user, capture());
    assert.equal(result.newRevision, true);
    assert.equal(result.inspection, 'passed');
    const detail = await setups.readSetup(user, result.setupId);
    assert.equal(detail.source, 'sdk');
    assert.equal(detail.fileName, 'fixed.sto');
    assert.equal(detail.latest.parameters.length, 68);
    assert.equal(detail.latest.fixedSession, false);
    assert.equal(detail.inspection, 'passed');
  });

  test('the same setup again only refreshes its readings; a changed setting is a new revision', async () => {
    const user = await makeUser();
    const first = await setups.recordCapture(user, capture());
    const hot = fixture.replace('LastHotPressure: 159 kPa', 'LastHotPressure: 171 kPa');
    const again = await setups.recordCapture(user, capture({ yaml: hot, observedAt: new Date() }));
    assert.equal(again.newRevision, false);
    assert.equal(again.revisionId, first.revisionId);
    const refreshed = await setups.readRevision(user, first.revisionId);
    assert.equal(refreshed.parameters.find((p) => p.path === 'TiresAero.LeftFront.LastHotPressure').raw, '171 kPa');

    const changed = await setups.recordCapture(user, capture({ yaml: fixture.replace('ArbBlades: 5', 'ArbBlades: 4'), modified: true }));
    assert.equal(changed.newRevision, true);
    const revision = await setups.readRevision(user, changed.revisionId);
    assert.equal(revision.number, 2);
    assert.deepEqual(revision.changed, [{ path: 'Chassis.FrontBrakes.ArbBlades', from: '5', to: '4' }]);
    assert.equal(revision.simModified, true);
  });

  test('an uploaded .sto joins the setup iRacing loaded under its name, and is kept byte for byte', async () => {
    const user = await makeUser();
    const seen = await setups.recordCapture(user, capture());
    const bytes = sto();
    const uploaded = await setups.createStoSetup(user, { fileName: 'fixed.sto', bytes, car: 'BMW M4 GT3 EVO' });
    assert.equal(uploaded.setupId, seen.setupId);
    assert.equal(uploaded.info.status, 'partial');
    const again = await setups.createStoSetup(user, { fileName: 'other.sto', bytes });
    assert.equal(again.duplicate, true);
    const file = await setups.readStoBytes(user, seen.setupId);
    assert.ok(file.bytes.equals(bytes));
    assert.equal((await setups.readSetup(user, seen.setupId)).source, 'sto');
    // A capture of it later still goes to that setup
    const later = await setups.recordCapture(user, capture());
    assert.equal(later.setupId, seen.setupId);
  });

  test('nobody reaches another user’s setups', async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const { setupId, revisionId } = await setups.recordCapture(owner, capture());
    assert.equal(await setups.readSetup(other, setupId), null);
    assert.equal(await setups.readRevision(other, revisionId), null);
    assert.equal(await setups.readStoBytes(other, setupId), null);
    assert.equal(await setups.updateSetup(other, setupId, { name: 'mine now' }), false);
    assert.equal(await setups.deleteSetup(other, setupId), false);
    await assert.rejects(setups.createRevisionFromChanges(other, revisionId, [{ path: 'Chassis.Rear.WingAngle', value: 7 }], { kind: 'manual', author: 'user', summary: '' }), /notFound/);
    await assert.rejects(setups.restoreRevision(other, revisionId), /notFound/);
    await assert.rejects(setups.duplicateSetup(other, setupId, 'copy'), /notFound/);
    assert.deepEqual(await setups.listSetups(other), []);
    assert.equal((await setups.readSetup(owner, setupId)).name, 'fixed');
  });

  test('a change makes a new revision; loading it in iRacing marks it observed and links the inspection', async () => {
    const user = await makeUser();
    const { setupId, revisionId } = await setups.recordCapture(user, capture());
    const made = await setups.createRevisionFromChanges(user, revisionId, [{ path: 'Chassis.Rear.WingAngle', value: 7 }], { kind: 'manual', author: 'user', summary: 'more wing' });
    assert.deepEqual(made.changed, [{ path: 'Chassis.Rear.WingAngle', from: '6 degrees', to: '7 degrees' }]);
    const original = await setups.readRevision(user, revisionId);
    assert.equal(original.parameters.find((p) => p.path === 'Chassis.Rear.WingAngle').raw, '6 degrees');
    await assert.rejects(setups.createRevisionFromChanges(user, revisionId, [{ path: 'Chassis.LeftFront.CornerWeight', value: 1 }], { kind: 'manual', author: 'user', summary: '' }), /reading/);

    // The driver set the wing in the garage and saved it under another name, then iRacing failed it
    await setups.recordCapture(user, capture({ setupName: 'wing7.sto', yaml: fixture.replace('WingAngle: 6 degrees', 'WingAngle: 7 degrees'), passedTech: 0 }));
    assert.equal((await setups.readRevision(user, made.revisionId)).observedInIracing, true);
    const [inspection] = await setups.readInspections(user, 1);
    assert.equal(inspection.result, 'failed');
    assert.equal(inspection.matchedRevisionId, made.revisionId);

    const restored = await setups.restoreRevision(user, revisionId);
    const back = await setups.readRevision(user, restored);
    assert.equal(back.kind, 'restore');
    assert.equal(back.parameters.find((p) => p.path === 'Chassis.Rear.WingAngle').raw, '6 degrees');
    assert.equal((await setups.readSetup(user, setupId)).revisionList.length, 3);
  });

  test('a proposal changes nothing until it is decided, and is decided once', async () => {
    const user = await makeUser();
    const { setupId, revisionId } = await setups.recordCapture(user, capture());
    const change = (path, proposedValue, proposed) => ({ path, current: '', proposed, proposedValue, unit: null, reason: 'r', expectedEffect: 'e', confidence: 'low', warnings: ['rangeUnknown'] });
    const proposal = await setups.saveProposal(user, {
      setupId,
      revisionId,
      compareRevisionId: null,
      question: 'Understeer on entry',
      answer: { summary: 's', findings: [], hypotheses: [], recommendations: [] },
      changes: [change('Chassis.FrontBrakes.ArbBlades', 4, '4'), change('Chassis.Rear.ArbBlades', 4, '4')],
    });
    assert.equal((await setups.readSetup(user, setupId)).revisionList.length, 1);
    const decided = await setups.decideProposal(user, proposal.id, ['Chassis.FrontBrakes.ArbBlades']);
    const revision = await setups.readRevision(user, decided.revisionId);
    assert.equal(revision.kind, 'engineer');
    assert.equal(revision.author, 'setupEngineer');
    assert.deepEqual(revision.changed.map((c) => c.path), ['Chassis.FrontBrakes.ArbBlades']);
    assert.deepEqual(decided.proposal.changes.map((c) => c.status), ['accepted', 'rejected']);
    const twice = await setups.decideProposal(user, proposal.id, ['Chassis.Rear.ArbBlades']);
    assert.equal(twice.revisionId, decided.revisionId);
    assert.equal((await setups.readSetup(user, setupId)).revisionList.length, 2);
    const other = await makeUser();
    await assert.rejects(setups.decideProposal(other, proposal.id, []), /notFound/);
  });

  test('laps driven while a capture was loaded are linked to it, and expired laps are not', async () => {
    const user = await makeUser();
    const start = new Date(Date.now() - 20 * 60 * 1000);
    const { revisionId } = await setups.recordCapture(user, capture({ observedAt: start }));
    await setups.recordCapture(user, capture({ observedAt: new Date(Date.now() - 60 * 1000) }));
    const csv = gzipSync('Speed,LapDistPct,Brake,Throttle\n10,0.1,0,1\n20,0.5,0.5,0\n30,0.9,0,1\n');
    const lap = (minutesAgo, lapNumber, carKey = 'bmwm4gt3') =>
      laps.saveCollectorLap(
        user,
        {
          clientLapId: randomUUID(),
          track: 'Mobility Resort Motegi (Full Road Course)',
          trackKey: 'twinring fullrc',
          car: 'BMW M4 GT3 EVO',
          carKey,
          driver: 'iRacing Name',
          sessionId: 10,
          subSessionId: 20,
          sessionNum: 0,
          sessionType: 'Practice',
          lapNumber,
          lapTimeSeconds: 106 + lapNumber / 10,
          samples: 3,
          missingSamples: 0,
          incidents: 0,
          pitRoad: false,
          offTrack: false,
          recordedAt: new Date(Date.now() - minutesAgo * 60 * 1000).toISOString(),
        },
        csv,
        100,
        false
      );
    await lap(15, 2);
    await lap(10, 3);
    await lap(30, 1); // before the setup was loaded
    await lap(12, 4, 'porsche992rgt3'); // another car
    const linked = await setups.readLinkedLaps(user, revisionId);
    assert.equal(linked.laps, 2);
    assert.equal(linked.cleanLaps, 2);
    assert.equal(linked.bestSeconds, 106.2);
    await q(`UPDATE racingcoach."CollectorLaps" SET expires_at = now() - interval '1 minute' WHERE user_id = $1 AND lap_number = 3`, [user]);
    assert.equal((await setups.readLinkedLaps(user, revisionId)).laps, 1);
  });

  test('history, the overview, erasure and Delete Account', async () => {
    const user = await makeUser();
    const { setupId, revisionId } = await setups.recordCapture(user, capture());
    await setups.createRevisionFromChanges(user, revisionId, [{ path: 'Chassis.Rear.WingAngle', value: 7 }], { kind: 'manual', author: 'user', summary: '' });
    const history = await setups.readHistory(user, setupId);
    assert.deepEqual(history.map((h) => h.type).sort(), ['inspection', 'revision', 'revision']);
    const overview = await setups.readOverview(user);
    assert.equal(overview.setups, 1);
    assert.equal(overview.revisions, 2);
    assert.equal(overview.latestInspection.result, 'passed');

    assert.ok((await erasure.eraseCategory(client, user, 'setups', null)) >= 1);
    for (const table of ['Setups', 'SetupValues', 'SetupInspections']) {
      assert.equal((await q(`SELECT count(*)::int AS n FROM racingcoach."${table}" WHERE user_id = $1`, [user]))[0].n, 0, table);
    }

    const second = await makeUser();
    await setups.recordCapture(second, capture());
    await q(`DELETE FROM racingcoach."Users" WHERE id = $1`, [second]);
    for (const table of ['Setups', 'SetupRevisions', 'SetupValues', 'SetupInspections', 'SetupProposals']) {
      assert.equal((await q(`SELECT count(*)::int AS n FROM racingcoach."${table}" WHERE user_id = $1`, [second]))[0].n, 0, table);
    }
  });
});
