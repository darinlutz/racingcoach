import pg from 'pg';

// The bot's connection to the RacingCoach database, set up like the website's src/lib/db.ts:
// DATABASE_URL as-is, with every connection defaulting to the racingcoach schema.
// The website creates the tables; the bot only reads them.

const DB_SCHEMA = 'racingcoach';

let pool;

function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is not set');
    }
    pool = new pg.Pool({ connectionString, options: `-c search_path=${DB_SCHEMA}` });
  }
  return pool;
}

export async function query(sql, params = []) {
  const result = await getPool().query(sql, params);
  return result.rows;
}

export async function closeDb() {
  if (pool) await pool.end();
}

// The RacingCoach account linked to a Discord user with the Account page's Connect Discord
// button, or null when they haven't linked one.
export async function getLinkedUser(discordUserId) {
  const [row] = await query(
    `SELECT u.id, u.user_name, u.account_status
     FROM racingcoach."DiscordConnections" d
     JOIN racingcoach."Users" u ON u.id = d.user_id
     WHERE d.discord_user_id = $1`,
    [discordUserId],
  );
  if (!row) return null;
  return { id: row.id, userName: row.user_name, accountStatus: row.account_status };
}
