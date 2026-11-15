import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { databaseVerdict } from './serverEnvironment';

// Cached on globalThis so dev-server hot reloads reuse one pool instead of
// opening a new set of connections on every edit.
const globalForDb = globalThis as typeof globalThis & { pgPool?: Pool; dbGuard?: Promise<void> };

// DATABASE_URL is a standard Postgres connection string; hosted providers
// that require TLS take `?sslmode=require` on the end of it.
// Every connection defaults to the racingcoach schema, so even unqualified
// table names resolve there.
const DB_SCHEMA = 'racingcoach';

function getPool(): Pool {
  if (!globalForDb.pgPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is not set');
    }
    // 25 connections (pg's default is 10) so race-night lap uploads, live updates and AI routes don't queue. Render
    // Postgres allows at least 100: two of these pools while a deploy overlaps, the bot's 10 and the MCP tools' 3 fit.
    // A query that still can't get one within 10 s fails instead of waiting forever.
    // No statement may run longer than PG_STATEMENT_TIMEOUT_MS (60 s by default), nor a transaction sit idle for a
    // minute, so a stuck query can't hold a connection (and its locks) forever.
    const statementTimeout = Number(process.env.PG_STATEMENT_TIMEOUT_MS) || 60_000;
    globalForDb.pgPool = new Pool({
      connectionString,
      options: `-c search_path=${DB_SCHEMA} -c statement_timeout=${statementTimeout} -c idle_in_transaction_session_timeout=60000`,
      max: Number(process.env.PG_POOL_MAX) || 25,
      connectionTimeoutMillis: 10_000,
    });
    // An idle connection the database drops (a restart, maintenance, a network blip) is reported here; without a
    // listener Node treats it as an unhandled error and the whole server exits. The pool replaces the connection.
    globalForDb.pgPool.on('error', (error) => console.error('Postgres pool error (idle connection dropped):', error.message));
  }
  return globalForDb.pgPool;
}

// Thrown by every query when a non-production server is pointed at the production database (serverEnvironment.ts)
export class ProductionDatabaseError extends Error {}

// Before the first query, checks how the database is marked (racingcoach."DatabaseEnvironment") and refuses the
// production database outside the live server; the live server marks its own database 'production' here. Checked once
// per process; a refusal sticks (every query fails with the same message), a connection error is tried again.
async function checkDatabaseEnvironment(pool: Pool): Promise<void> {
  const [{ present }] = (await pool.query<{ present: boolean }>(
    `SELECT to_regclass('racingcoach."DatabaseEnvironment"') IS NOT NULL AS present`
  )).rows;
  const marked = present
    ? (await pool.query<{ environment: string }>('SELECT environment FROM racingcoach."DatabaseEnvironment" LIMIT 1')).rows[0]
        ?.environment ?? null
    : null;
  const verdict = databaseVerdict(marked);
  if (!verdict.allowed) {
    console.error(verdict.reason);
    throw new ProductionDatabaseError(verdict.reason);
  }
  if (verdict.warning) console.warn(verdict.warning);
  // Best effort: a failure (e.g. two instances creating the table at once during a deploy) never stops the live
  // site's queries, and the next start tries again
  if (verdict.mark) await markProduction(pool).catch((error) => console.warn('Could not mark the database as production:', error.message));
}

async function markProduction(pool: Pool): Promise<void> {
  await pool.query('CREATE SCHEMA IF NOT EXISTS racingcoach');
  await pool.query(`CREATE TABLE IF NOT EXISTS racingcoach."DatabaseEnvironment" (
    id boolean PRIMARY KEY DEFAULT true CHECK (id),
    environment text NOT NULL,
    marked_at timestamptz NOT NULL DEFAULT now()
  )`);
  await pool.query(
    `INSERT INTO racingcoach."DatabaseEnvironment" (environment) VALUES ('production')
     ON CONFLICT (id) DO UPDATE SET environment = 'production', marked_at = now()`
  );
  console.log('Database marked as production (racingcoach."DatabaseEnvironment")');
}

async function readyPool(): Promise<Pool> {
  const pool = getPool();
  if (!globalForDb.dbGuard) {
    globalForDb.dbGuard = checkDatabaseEnvironment(pool).catch((error) => {
      if (!(error instanceof ProductionDatabaseError)) globalForDb.dbGuard = undefined;
      throw error;
    });
  }
  await globalForDb.dbGuard;
  return pool;
}

export async function query<Row extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = []
): Promise<Row[]> {
  const pool = await readyPool();
  try {
    return (await pool.query<Row>(sql, params)).rows;
  } catch (error) {
    // Postgres ends a deadlock by failing one of the statements in it (seen while a deploy's schema update, which
    // locks whole tables, overlaps the old server's traffic). A statement run on its own did nothing when it fails,
    // so it's safe to run once more, by which time the other side has normally finished.
    if (!isDeadlock(error)) throw error;
    console.warn('Deadlock detected; running the statement again');
    await new Promise((resolve) => setTimeout(resolve, 100 + Math.random() * 200));
    return (await pool.query<Row>(sql, params)).rows;
  }
}

// Postgres SQLSTATE for deadlock_detected
function isDeadlock(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '40P01';
}

// The pool only listens for errors on idle connections. One that's checked out and drops between statements (the
// database restarting while a job holds it across other work) would report its error to nobody, which Node treats as
// an uncaught exception. The next statement on it fails anyway, and that's the error the caller sees.
function listenForDrop(client: PoolClient): () => void {
  const onError = (error: Error) => console.error('Postgres connection dropped while in use:', error.message);
  client.on('error', onError);
  return () => client.removeListener('error', onError);
}

// Runs `fn` inside a transaction on a single connection, rolling back if it throws.
export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await (await readyPool()).connect();
  const stopListening = listenForDrop(client);
  let broken: Error | undefined;
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    // A rollback that fails too (the connection is gone) must not replace the error that says what went wrong, and
    // its connection isn't put back in the pool
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      broken = rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError));
    }
    throw error;
  } finally {
    stopListening();
    client.release(broken);
  }
}

// Runs `fn` on one connection outside a transaction (each statement commits on its own), e.g. to hold a session-level
// advisory lock across several statements.
export async function withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await (await readyPool()).connect();
  const stopListening = listenForDrop(client);
  try {
    return await fn(client);
  } finally {
    stopListening();
    client.release();
  }
}

// Postgres SQLSTATE for a unique constraint violation.
export function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '23505';
}
