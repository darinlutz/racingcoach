import { randomUUID } from 'node:crypto';
import { query } from './db';
import { ensureUserSchema } from './users';

export type Friend = {
  id: string;
  name: string;
  country: string;
};

// Each user has their own friends in racingcoach."Friends" (created alongside
// racingcoach."Users" by ensureUserSchema).

export async function readFriends(userId: number): Promise<Friend[]> {
  await ensureUserSchema();
  const rows = await query('SELECT id, name, country FROM racingcoach."Friends" WHERE user_id = $1 ORDER BY seq', [
    userId,
  ]);
  return rows.map((row) => ({
    id: row.id as string,
    name: row.name as string,
    country: row.country as string,
  }));
}

export async function addFriend(userId: number, name: string, country: string): Promise<Friend> {
  await ensureUserSchema();
  const friend: Friend = { id: randomUUID(), name, country };
  await query('INSERT INTO racingcoach."Friends" (id, user_id, name, country) VALUES ($1, $2, $3, $4)', [
    friend.id,
    userId,
    friend.name,
    friend.country,
  ]);
  return friend;
}

// Only removes the friend if it belongs to this user.
export async function deleteFriend(userId: number, id: string): Promise<void> {
  await ensureUserSchema();
  await query('DELETE FROM racingcoach."Friends" WHERE id = $1 AND user_id = $2', [id, userId]);
}
