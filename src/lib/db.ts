import { Pool, type PoolClient, type QueryResultRow } from 'pg';

// Cached on globalThis so dev-server hot reloads reuse one pool instead of
// opening a new set of connections on every edit.
const globalForDb = globalThis as typeof globalThis & { pgPool?: Pool };

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

export async function query<Row extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = []
): Promise<Row[]> {
  const result = await getPool().query<Row>(sql, params);
  return result.rows;
}

// Runs `fn` inside a transaction on a single connection, rolling back if it throws.
export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Runs `fn` on one connection outside a transaction (each statement commits on its own), e.g. to hold a session-level
// advisory lock across several statements.
export async function withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

// Postgres SQLSTATE for a unique constraint violation.
export function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '23505';
}
