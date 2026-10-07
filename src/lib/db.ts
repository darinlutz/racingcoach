import { Pool, type PoolClient, type QueryArrayConfig, type QueryResultRow } from 'pg';

// Cached on globalThis so dev-server hot reloads reuse one pool instead of
// opening a new set of connections on every edit.
const globalForDb = globalThis as typeof globalThis & { pgPool?: Pool };

// DATABASE_URL is a standard Postgres connection string; hosted providers
// that require TLS take `?sslmode=require` on the end of it.
// Every connection defaults to the racingcoach schema, so even unqualified
// table names (e.g. in the admin SQL Query tab) resolve there.
const DB_SCHEMA = 'racingcoach';

function getPool(): Pool {
  if (!globalForDb.pgPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is not set');
    }
    globalForDb.pgPool = new Pool({ connectionString, options: `-c search_path=${DB_SCHEMA}` });
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

export type ReadOnlyResult = {
  command: string;
  columns: string[];
  rows: unknown[][];
  // Total rows the query returned or affected; `rows` holds at most `maxRows`
  rowCount: number;
  truncated: boolean;
};

// Runs one SQL statement typed by an admin (Trends page's SQL Query tab) in a
// read-only transaction that is always rolled back. The extended protocol
// rejects multiple statements, so "COMMIT; DROP ..." can't escape it, and the
// connection is discarded afterwards so no session setting leaks back into
// the pool.
export async function runReadOnlyQuery(sql: string, maxRows = 1000): Promise<ReadOnlyResult> {
  const client = await getPool().connect();
  let broken: Error | undefined;
  try {
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout = '10s'");
    // queryMode is supported by pg but missing from @types/pg
    const config: QueryArrayConfig & { queryMode: 'extended' } = { text: sql, rowMode: 'array', queryMode: 'extended' };
    const result = await client.query(config);
    const rows = (result.rows ?? []) as unknown[][];
    return {
      command: result.command ?? '',
      columns: (result.fields ?? []).map((field) => field.name),
      rows: rows.slice(0, maxRows),
      rowCount: result.rowCount ?? rows.length,
      truncated: rows.length > maxRows,
    };
  } catch (error) {
    broken = error as Error;
    throw error;
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release(broken ?? true);
  }
}

// Postgres SQLSTATE for a unique constraint violation.
export function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '23505';
}
