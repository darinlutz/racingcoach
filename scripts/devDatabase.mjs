// Sets up the local development database (docs/development-database.md):
//   npm run db:dev                       creates the racingcoach schema and its tables in DATABASE_URL
//   npm run db:dev -- --copy-from production   (PRODUCTION_DATABASE_URL in .env.local), or --copy-from <url>:
//                                        and then copies the shared reference data from another database (normally
//                                        production's, read only): Track Data, Car Data, corners, simulator mappings
//                                        and site settings. Never a user, lap or anything personal.
//
// DATABASE_URL comes from the environment, or .env.local like `next dev`. It must be a database on this computer that
// the live site hasn't marked as production; the script refuses anything else, as it empties the tables it copies.

import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import pg from 'pg';

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1', '[::1]'];

// Shared, not personal, copied in this order (a focus area needs its track). A column that points at a user is left
// empty, as the development database has none of production's accounts.
const TABLES = ['Tracks', 'TrackFocusAreas', 'Cars', 'TracksNumberOfCorners', 'SimulatorTracks', 'SimulatorCars', 'SiteSettings'];
// Site settings that belong to the live site's own Stripe account and spend state, not to development
const SKIPPED_SETTINGS = ['stripe_portal_configuration', 'spend_monitor_state'];

function envLocal(name) {
  if (process.env[name]) return process.env[name];
  try {
    const line = readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
    return line?.slice(name.length + 1).trim().replace(/^["']|["']$/g, '') || undefined;
  } catch {
    return undefined;
  }
}

const target = envLocal('DATABASE_URL');
if (!target) throw new Error('DATABASE_URL is not set (environment or .env.local)');
if (!LOCAL_HOSTS.includes(new URL(target).hostname)) {
  throw new Error(`Refusing: DATABASE_URL is on ${new URL(target).hostname}, not this computer. The development database must be local.`);
}
const fromIndex = process.argv.indexOf('--copy-from');
const fromArg = fromIndex > 0 ? process.argv[fromIndex + 1] : undefined;
// `--copy-from production` is PRODUCTION_DATABASE_URL, from the environment or .env.local
const source = fromArg === 'production' ? envLocal('PRODUCTION_DATABASE_URL') : fromArg;
if (fromIndex > 0 && !source) throw new Error('--copy-from needs a database URL, or production with PRODUCTION_DATABASE_URL set');

// The site's own schema code makes the tables, through src/lib/db.ts and its production guard
process.env.DATABASE_URL = target;
process.env.LIVE_SERVER = 'off';
register(new URL('./ts-resolve-hooks.mjs', import.meta.url));
const { ensureUserSchema } = await import(new URL('../src/lib/users.ts', import.meta.url).href);
await ensureUserSchema();
console.log(`Schema ready in ${new URL(target).pathname.slice(1)}`);

if (source) {
  const from = new pg.Client({ connectionString: source, options: '-c default_transaction_read_only=on' });
  const to = new pg.Client({ connectionString: target });
  await from.connect();
  await to.connect();
  try {
    await to.query('BEGIN');
    // DELETE rather than TRUNCATE ... CASCADE, which would also empty the development database's own tables that point
    // at a track or car (broadcast videos); theirs are set NULL instead
    for (const table of [...TABLES].reverse()) await to.query(`DELETE FROM racingcoach."${table}"`);
    for (const table of TABLES) {
      const columns = (await to.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = 'racingcoach' AND table_name = $1 ORDER BY ordinal_position`,
        [table]
      )).rows.map((r) => r.column_name);
      const userColumns = new Set((await to.query(
        `SELECT kcu.column_name FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
           JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
          WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'racingcoach' AND tc.table_name = $1 AND ccu.table_name = 'Users'`,
        [table]
      )).rows.map((r) => r.column_name));
      const sourceColumns = new Set((await from.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = 'racingcoach' AND table_name = $1`,
        [table]
      )).rows.map((r) => r.column_name));
      const copied = columns.filter((c) => sourceColumns.has(c) && !userColumns.has(c));
      const where = table === 'SiteSettings' ? `WHERE key <> ALL($1)` : '';
      const rows = (await from.query(
        `SELECT ${copied.map((c) => `"${c}"`).join(', ')} FROM racingcoach."${table}" ${where}`,
        table === 'SiteSettings' ? [SKIPPED_SETTINGS] : []
      )).rows;
      const list = copied.map((c) => `"${c}"`).join(', ');
      for (let i = 0; i < rows.length; i += 200) {
        await to.query(
          `INSERT INTO racingcoach."${table}" (${list}) OVERRIDING SYSTEM VALUE
           SELECT ${list} FROM json_populate_recordset(NULL::racingcoach."${table}", $1)`,
          [JSON.stringify(rows.slice(i, i + 200))]
        );
      }
      // Serial and identity columns carry on after the copied IDs
      const sequences = (await to.query(
        `SELECT column_name, pg_get_serial_sequence($1, column_name) AS seq FROM information_schema.columns
          WHERE table_schema = 'racingcoach' AND table_name = $2`,
        [`racingcoach."${table}"`, table]
      )).rows.filter((r) => r.seq);
      for (const { column_name: column, seq } of sequences) {
        await to.query(`SELECT setval($1, GREATEST(COALESCE((SELECT max("${column}") FROM racingcoach."${table}"), 0), 1))`, [seq]);
      }
      console.log(`  ${table}: ${rows.length} rows`);
    }
    await to.query('COMMIT');
    console.log('Reference data copied');
  } catch (error) {
    await to.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await from.end();
    await to.end();
  }
}

await globalThis.pgPool?.end();
