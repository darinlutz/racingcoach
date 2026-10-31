import { query } from './db';
import { ensureUserSchema } from './users';

// Each user's own picture on My Dashboard, in racingcoach."UserPictures" (a JPEG of at most 1 MB, see
// profilePictureRules.ts), kept out of USER_COLUMNS so loading a user doesn't read a picture. None is the red helmet.

// When the picture was last changed, which My Dashboard and the sidebar put in its URL so a new picture shows; null when there's none
export async function getProfilePictureVersion(userId: number): Promise<string | null> {
  await ensureUserSchema();
  const [row] = await query('SELECT updated_at FROM racingcoach."UserPictures" WHERE user_id = $1', [userId]);
  return row ? new Date(row.updated_at as string).toISOString() : null;
}

export async function readProfilePicture(userId: number): Promise<Buffer | null> {
  await ensureUserSchema();
  const [row] = await query('SELECT image FROM racingcoach."UserPictures" WHERE user_id = $1', [userId]);
  return row ? (row.image as Buffer) : null;
}

export async function saveProfilePicture(userId: number, image: Buffer): Promise<string> {
  await ensureUserSchema();
  const [row] = await query(
    `INSERT INTO racingcoach."UserPictures" (user_id, image) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET image = EXCLUDED.image, updated_at = now()
     RETURNING updated_at`,
    [userId, image]
  );
  return new Date(row.updated_at as string).toISOString();
}

export async function removeProfilePicture(userId: number): Promise<void> {
  await ensureUserSchema();
  await query('DELETE FROM racingcoach."UserPictures" WHERE user_id = $1', [userId]);
}
