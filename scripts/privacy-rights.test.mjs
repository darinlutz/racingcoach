// Data subject rights rules: npm run test:privacy-rights
//
// The pure parts (src/lib/privacyRules.ts, personalDataInventory.ts, csvExport.ts, zipWriter.ts), run straight from
// their .ts files, plus guards over the source: every table holding a user's rows is in the personal data inventory,
// every erasable category has its erasure statements and labels in every language, and the privacy routes check who's
// asking before anything else. The database tests are privacy-rights-db.test.mjs.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { crc32, inflateRawSync } from 'node:zlib';
import {
  addCalendarMonths,
  canExtend,
  canTransition,
  cleanCategories,
  currentDeadline,
  deadlineState,
  dueDate,
  ERASABLE_CATEGORIES,
  extendedDueDate,
  isClosed,
  needsReason,
  needsReview,
  REQUEST_STATUSES,
  requestReference,
} from '../src/lib/privacyRules.ts';
import { NON_PERSONAL_TABLES, PERSONAL_DATA_INVENTORY } from '../src/lib/personalDataInventory.ts';
import { toCsv } from '../src/lib/csvExport.ts';
import { ZipWriter } from '../src/lib/zipWriter.ts';

const root = new URL('../', import.meta.url);
const read = (file) => fs.readFileSync(new URL(file, root), 'utf8');
const utc = (y, m, d, h = 12) => new Date(Date.UTC(y, m - 1, d, h));
const iso = (date) => date.toISOString().slice(0, 10);

describe('deadlines (Article 12(3))', () => {
  test('one month runs to the same date of the next month', () => {
    assert.equal(iso(dueDate(utc(2026, 1, 15))), '2026-02-15');
    assert.equal(iso(dueDate(utc(2026, 12, 31))), '2027-01-31');
  });

  test('a month without that date ends on its last day', () => {
    assert.equal(iso(dueDate(utc(2026, 1, 31))), '2026-02-28');
    assert.equal(iso(dueDate(utc(2028, 1, 31))), '2028-02-29');
    assert.equal(iso(dueDate(utc(2026, 3, 31))), '2026-04-30');
  });

  test('the extension is two more months from receipt, so three in all', () => {
    assert.equal(iso(extendedDueDate(utc(2026, 1, 31))), '2026-04-30');
    assert.equal(iso(extendedDueDate(utc(2026, 11, 30))), '2027-02-28');
  });

  test('the time of day is kept, so the deadline is the same instant a month later', () => {
    const received = new Date(Date.UTC(2026, 4, 10, 23, 59, 30));
    assert.equal(dueDate(received).toISOString(), '2026-06-10T23:59:30.000Z');
    assert.equal(addCalendarMonths(received, 0).getTime(), received.getTime());
  });

  test('deadline states', () => {
    const received = utc(2026, 1, 1);
    const request = { status: 'in_review', dueAt: dueDate(received), extendedDueAt: null };
    assert.equal(deadlineState(request, utc(2026, 1, 10)), 'onTrack');
    assert.equal(deadlineState(request, utc(2026, 1, 28)), 'dueSoon');
    assert.equal(deadlineState(request, utc(2026, 2, 2)), 'overdue');
    assert.equal(deadlineState({ ...request, status: 'completed' }, utc(2026, 3, 1)), 'closed');
    const extended = { ...request, status: 'extended', extendedDueAt: extendedDueDate(received) };
    assert.equal(currentDeadline(extended).getTime(), extendedDueDate(received).getTime());
    assert.equal(deadlineState(extended, utc(2026, 2, 2)), 'onTrack');
  });
});

describe('request statuses', () => {
  test('Completed and Rejected are final', () => {
    for (const to of REQUEST_STATUSES) {
      assert.equal(canTransition('completed', to), false, to);
      assert.equal(canTransition('rejected', to), false, to);
    }
    assert.ok(isClosed('completed') && isClosed('rejected') && !isClosed('extended'));
  });

  test('an unverified request can only be verified or rejected', () => {
    assert.deepEqual(
      REQUEST_STATUSES.filter((to) => canTransition('pending_verification', to)),
      ['submitted', 'rejected']
    );
  });

  test('every open status can reach Completed and Rejected', () => {
    for (const from of ['submitted', 'in_review', 'processing', 'extended']) {
      assert.ok(canTransition(from, 'completed'), from);
      assert.ok(canTransition(from, 'rejected'), from);
    }
  });

  test('refusing and extending need a reason', () => {
    assert.ok(needsReason('rejected'));
    assert.ok(needsReason('extended'));
    assert.ok(!needsReason('completed'));
  });

  test('an extension is allowed once, and only before the first deadline', () => {
    const received = utc(2026, 1, 1);
    const open = { status: 'in_review', dueAt: dueDate(received), extendedDueAt: null };
    assert.ok(canExtend(open, utc(2026, 1, 20)));
    assert.ok(!canExtend(open, utc(2026, 2, 2)), 'after the deadline');
    assert.ok(!canExtend({ ...open, extendedDueAt: extendedDueDate(received) }, utc(2026, 1, 20)), 'twice');
    assert.ok(!canExtend({ ...open, status: 'extended' }, utc(2026, 1, 20)), 'from Extended');
    assert.ok(!canExtend({ ...open, status: 'completed' }, utc(2026, 1, 20)), 'closed');
  });

  test('a reference is short and stable', () => {
    assert.equal(requestReference('3f9a2c1b-0000-4000-8000-000000000000'), 'PR-3F9A2C1B');
  });
});

describe('erasable categories', () => {
  test('requests keep known categories once, in order', () => {
    assert.deepEqual(cleanCategories(['friends', 'laps', 'laps', 'password', 7]), ['laps', 'friends']);
    assert.deepEqual(cleanCategories('laps'), []);
  });

  test('the security records are reviewed; the user’s own content is not', () => {
    assert.ok(needsReview('activityLog') && needsReview('aiUsage'));
    assert.ok(!needsReview('laps') && !needsReview('debriefs'));
  });

  test('every category has erasure statements, an inventory entry and a label in every language', () => {
    const erasure = read('src/lib/dataErasure.ts');
    const dictionaries = ['en', 'pt', 'es', 'de'].map((lang) => read(`src/lib/i18n/dictionaries/${lang}.ts`));
    for (const category of ERASABLE_CATEGORIES) {
      assert.match(erasure, new RegExp(`\\n  ${category}: \\[`), `dataErasure.ts STATEMENTS.${category}`);
      assert.ok(
        PERSONAL_DATA_INVENTORY.some((c) => typeof c.erasure === 'object' && c.erasure.category === category),
        `inventory erasure for ${category}`
      );
      for (const dictionary of dictionaries) assert.match(dictionary, new RegExp(`\\n      ${category}: '`), `label for ${category}`);
    }
  });
});

describe('personal data inventory', () => {
  // Every racingcoach table the code creates
  const tables = new Set();
  const userTables = new Set();
  for (const file of fs.readdirSync(new URL('src/lib/', root))) {
    if (!file.endsWith('.ts')) continue;
    const source = read(`src/lib/${file}`);
    for (const match of source.matchAll(/CREATE TABLE IF NOT EXISTS racingcoach\."(\w+)" \(([\s\S]*?)\n\s*\)`/g)) {
      tables.add(match[1]);
      if (/REFERENCES racingcoach\."Users"|\buser_id\b/.test(match[2])) userTables.add(match[1]);
    }
  }
  const inventoried = new Set(PERSONAL_DATA_INVENTORY.flatMap((c) => c.tables));

  test('finds the tables', () => {
    assert.ok(tables.has('Users') && tables.has('CollectorLaps') && tables.has('PrivacyRequests'), [...tables].join(', '));
  });

  test('every table is either in the inventory or known to hold no personal data', () => {
    for (const table of tables) {
      assert.ok(inventoried.has(table) || NON_PERSONAL_TABLES.includes(table), `${table} is in neither the inventory nor NON_PERSONAL_TABLES`);
    }
  });

  test('every table tied to a user is in the inventory', () => {
    for (const table of userTables) assert.ok(inventoried.has(table), table);
  });

  test('each category says what, why, on what basis, from where, how long and who receives it', () => {
    const keys = new Set();
    for (const c of PERSONAL_DATA_INVENTORY) {
      assert.ok(!keys.has(c.key), `duplicate ${c.key}`);
      keys.add(c.key);
      for (const field of ['title', 'description', 'purpose', 'source', 'storage', 'retention']) assert.ok(c[field], `${c.key}.${field}`);
      assert.ok(c.legalBasis.length > 0 && c.recipients.length > 0, c.key);
      // Portability is narrower than access (Article 20 data is always in an access export too)
      if (c.portable) assert.ok(c.access, `${c.key} portable but not in access`);
      if (c.erasure === 'retained') assert.ok(c.retainedReason, `${c.key} retained without a reason`);
    }
  });

  test('portability leaves out inferred, billing and legal records', () => {
    const byKey = Object.fromEntries(PERSONAL_DATA_INVENTORY.map((c) => [c.key, c]));
    for (const key of ['debriefs', 'billing', 'policyRecords', 'aiUsage', 'privacyRequests']) assert.equal(byKey[key].portable, false, key);
    for (const key of ['account', 'laps', 'targetLap', 'raceResults']) assert.equal(byKey[key].portable, true, key);
  });
});

describe('CSV export', () => {
  test('quotes commas, quotes and line breaks', () => {
    assert.equal(toCsv([{ a: 'x,y', b: 'say "hi"', c: 'two\nlines' }]), 'a,b,c\r\n"x,y","say ""hi""","two\nlines"\r\n');
  });

  test('a value a spreadsheet would run as a formula is defused, numbers are not', () => {
    const csv = toCsv([{ a: '=HYPERLINK("x")', b: '+1', c: '@SUM(A1)', d: -1.5, e: '-5', f: '-cmd' }]);
    assert.equal(csv.split('\r\n')[1], `"'=HYPERLINK(""x"")",'+1,'@SUM(A1),-1.5,-5,'-cmd`);
  });

  test('dates, objects and empty values', () => {
    const csv = toCsv([{ at: new Date(Date.UTC(2026, 0, 2)), o: { k: 1 }, n: null }], ['at', 'o', 'n']);
    assert.equal(csv.split('\r\n')[1], '2026-01-02T00:00:00.000Z,"{""k"":1}",');
  });

  test('no rows still has a header', () => {
    assert.equal(toCsv([], ['a', 'b']), 'a,b\r\n');
  });
});

// Reads back an archive by its central directory, as unzip tools do
function readZip(buffer) {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end >= 0, 'end of central directory');
  const count = buffer.readUInt16LE(end + 10);
  let at = buffer.readUInt32LE(end + 16);
  const entries = new Map();
  for (let i = 0; i < count; i += 1) {
    assert.equal(buffer.readUInt32LE(at), 0x02014b50);
    const method = buffer.readUInt16LE(at + 10);
    const crc = buffer.readUInt32LE(at + 16);
    const compressed = buffer.readUInt32LE(at + 20);
    const size = buffer.readUInt32LE(at + 24);
    const nameLength = buffer.readUInt16LE(at + 28);
    const offset = buffer.readUInt32LE(at + 42);
    const name = buffer.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    const localNameLength = buffer.readUInt16LE(offset + 26);
    const data = buffer.subarray(offset + 30 + localNameLength, offset + 30 + localNameLength + compressed);
    const content = method === 8 ? inflateRawSync(data) : Buffer.from(data);
    assert.equal(content.length, size, name);
    assert.equal(crc32(content) >>> 0, crc, name);
    entries.set(name, content);
    at += 46 + nameLength;
  }
  return entries;
}

describe('ZIP writer', () => {
  test('entries read back exactly, deflated or stored', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rc-zip-')), 'test.zip');
    const zip = new ZipWriter(file, new Date(Date.UTC(2026, 10, 2, 13, 45, 10)));
    const big = 'lap,speed\r\n'.repeat(5000);
    const random = Buffer.from(Array.from({ length: 512 }, (_, i) => (i * 7919) % 251));
    await zip.add('laps/laps.csv', big);
    await zip.add('account/profile_picture.jpg', random);
    await zip.add('ünïcode/名前.json', '{"ok":true}');
    await zip.add('empty.txt', '');
    const size = await zip.finish();
    const buffer = fs.readFileSync(file);
    assert.equal(buffer.length, size);
    const entries = readZip(buffer);
    assert.equal(entries.get('laps/laps.csv').toString(), big);
    assert.deepEqual(entries.get('account/profile_picture.jpg'), random);
    assert.equal(entries.get('ünïcode/名前.json').toString(), '{"ok":true}');
    assert.equal(entries.get('empty.txt').length, 0);
    assert.ok(buffer.length < big.length, 'the CSV was compressed');
  });

  test('names can’t escape the archive or repeat', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rc-zip-')), 'test.zip');
    const zip = new ZipWriter(file);
    await zip.add('../../etc/passwd', 'x');
    await assert.rejects(zip.add('etc/passwd', 'y'), /repeated/);
    await assert.rejects(zip.add('../..', 'y'), /Bad/);
    await zip.finish();
    assert.deepEqual([...readZip(fs.readFileSync(file)).keys()], ['etc/passwd']);
  });
});

describe('source guards', () => {
  const routes = (dir) =>
    fs
      .readdirSync(new URL(dir, root), { recursive: true })
      .filter((file) => String(file).endsWith('route.ts'))
      .map((file) => ({ file: `${dir}${String(file).replace(/\\/g, '/')}`, source: read(`${dir}${String(file).replace(/\\/g, '/')}`) }));

  test('every Admin privacy route answers anyone but an Admin with a 404 before doing anything', () => {
    for (const { file, source } of routes('src/app/api/admin/privacy/')) {
      for (const handler of source.split(/export async function /).slice(1)) {
        assert.match(handler, /if \(!user \|\| !isAdmin\(user\.role\)\) return NextResponse\.json\(\{ error: 'Not found' \}, \{ status: 404 \}\)/, file);
      }
    }
  });

  test('every account privacy route works on the session’s own account and takes no user ID', () => {
    for (const { file, source } of [...routes('src/app/api/account/privacy/'), { file: 'src/app/api/account/profile/route.ts', source: read('src/app/api/account/profile/route.ts') }]) {
      assert.match(source, /getCurrentUser\(\)/, file);
      assert.doesNotMatch(source, /body\.userId|params\.userId|searchParams\.get\('userId'\)/, file);
    }
  });

  test('exports and erasures need the step-up sign-in; Delete Account needs it and the typed confirmation', () => {
    const requests = read('src/app/api/account/privacy/requests/route.ts');
    assert.match(requests, /if \(sensitive && !\(await isRecentlyReauthenticated\(user\)\)\)/);
    const account = read('src/app/api/account/route.ts');
    assert.match(account, /body\.confirm !== 'DELETE'/);
    assert.match(account, /isRecentlyReauthenticated\(user\)/);
    // Stripe is canceled before the account is deleted, as before
    assert.ok(account.indexOf('stripe.subscriptions.cancel') < account.indexOf('deleteAccount(user)'));
  });

  test('an export never includes credentials', () => {
    const source = read('src/lib/personalDataExport.ts');
    assert.doesNotMatch(source, /SELECT[^`]*\bpassword\b[^`]*FROM/i, 'password hash');
    assert.doesNotMatch(source, /\bapi_key\b/, 'iRacePlan API key');
    assert.doesNotMatch(source, /\btoken_hash\b|\bkey_hash\b|\bcode_hash\b/, 'token hashes');
  });

  test('the Privacy Policy states the rules the code applies', async () => {
    const { privacyPolicy } = await import('../src/lib/legal.ts');
    const { NETWORK_DETAILS_RETENTION_MONTHS } = await import('../src/lib/activityRetention.ts');
    const text = JSON.stringify(privacyPolicy);
    assert.equal(NETWORK_DETAILS_RETENTION_MONTHS, 13);
    assert.ok(text.includes('removed 13 months after each visit'));
    assert.ok(text.includes('website activity log entries are anonymized'));
    assert.ok(text.includes('My Settings > Privacy & Data Rights'));
    assert.ok(text.includes('racingcoach.app/privacy-request'));
    assert.ok(text.includes('within one month'));
    assert.ok(text.includes('DeepSeek'), 'every AI provider is named');
  });

  test('laps and Debrief Coach runs in an export skip expired rows, like every lap read', () => {
    const source = read('src/lib/personalDataExport.ts');
    for (const table of ['CollectorLaps', 'DebriefSessions']) {
      for (const match of source.matchAll(new RegExp(`FROM racingcoach\\."${table}"[^\`]*`, 'g'))) {
        assert.match(match[0], /expires_at > now\(\)/, table);
      }
    }
  });
});
