import { query } from './db';

// The iRacing setup folders collectors have reported (setupFolderRules.ts): racingcoach."IRacingSetupFolders", one
// row per folder name, when it was first and last reported. No user is kept: the names are iRacing's car paths, the
// same on every PC (NON_PERSONAL_TABLES). Created on first use.

let schema: Promise<void> | null = null;

function ensureSchema(): Promise<void> {
  schema ??= query(`CREATE TABLE IF NOT EXISTS racingcoach."IRacingSetupFolders" (
      folder TEXT PRIMARY KEY,
      first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`)
    .then(() => undefined)
    .catch((error) => {
      schema = null;
      throw error;
    });
  return schema;
}

// Adds the folders not seen before and marks the others seen now
export async function recordSetupFolders(folders: string[]): Promise<number> {
  if (!folders.length) return 0;
  await ensureSchema();
  await query(
    `INSERT INTO racingcoach."IRacingSetupFolders" (folder) SELECT unnest($1::text[])
     ON CONFLICT (folder) DO UPDATE SET last_seen_at = now()`,
    [folders]
  );
  return folders.length;
}

// Every folder reported, by name
export async function listSetupFolders(): Promise<string[]> {
  await ensureSchema();
  const rows = await query<{ folder: string }>('SELECT folder FROM racingcoach."IRacingSetupFolders" ORDER BY folder');
  return rows.map((r) => r.folder);
}
