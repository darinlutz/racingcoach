import { randomUUID } from 'node:crypto';
import { query } from './db';
import { engineBedConfig, ENGINE_AUDIO_TYPES, type EngineAudioType, type EngineBedConfig } from './engineBedConfig';
import { deleteVideoObject, downloadObjectBytes, uploadObjectBytes } from './objectStorage';
import { getRaceAnnouncerSettings } from './raceAnnouncer';
import type { BroadcastSettings } from './broadcastSettings';
import { ensureUserSchema } from './users';

// The engine sounds an Admin uploaded (the Admin page's Engine Sounds, src/components/EngineAudioLibrary.tsx), which any
// listener can pick for the engine bed under ElevenLabs speech (src/lib/engineBed.ts): details in
// racingcoach."EngineAudioAssets", files in the Broadcast Video Library's object storage (src/lib/objectStorage.ts).
// A listener whose sound was deleted gets the built-in one.

export type EngineAudioAsset = { id: number; name: string; contentType: EngineAudioType; sizeBytes: number; createdAt: string };

type AssetRow = { id: number; name: string; content_type: EngineAudioType; size_bytes: string | number; created_at: Date };

const toAsset = (row: AssetRow): EngineAudioAsset => ({
  id: row.id,
  name: row.name,
  contentType: row.content_type,
  sizeBytes: Number(row.size_bytes),
  createdAt: row.created_at.toISOString(),
});

export async function listEngineAudioAssets(): Promise<EngineAudioAsset[]> {
  await ensureUserSchema();
  const rows = await query<AssetRow>('SELECT id, name, content_type, size_bytes, created_at FROM racingcoach."EngineAudioAssets" ORDER BY lower(name), id');
  return rows.map(toAsset);
}

export async function createEngineAudioAsset(name: string, bytes: Buffer, contentType: EngineAudioType, userId: number): Promise<EngineAudioAsset> {
  await ensureUserSchema();
  const key = `engine-audio/${randomUUID()}.${ENGINE_AUDIO_TYPES[contentType]}`;
  await uploadObjectBytes(key, bytes, contentType);
  try {
    const [row] = await query<AssetRow>(
      `INSERT INTO racingcoach."EngineAudioAssets" (name, storage_key, content_type, size_bytes, uploaded_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, name, content_type, size_bytes, created_at`,
      [name, key, contentType, bytes.length, userId]
    );
    return toAsset(row);
  } catch (error) {
    await deleteVideoObject(key).catch(() => undefined);
    throw error;
  }
}

export async function deleteEngineAudioAsset(id: number): Promise<boolean> {
  await ensureUserSchema();
  const [row] = await query<{ storage_key: string }>('DELETE FROM racingcoach."EngineAudioAssets" WHERE id = $1 RETURNING storage_key', [id]);
  if (!row) return false;
  // Nothing refers to the file any more; one left behind in storage only takes up space
  await deleteVideoObject(row.storage_key).catch((error) => console.error('Engine sound delete error:', error));
  return true;
}

export async function readEngineAudioFile(id: number): Promise<{ bytes: Buffer; contentType: EngineAudioType } | null> {
  await ensureUserSchema();
  const [row] = await query<{ storage_key: string; content_type: EngineAudioType }>('SELECT storage_key, content_type FROM racingcoach."EngineAudioAssets" WHERE id = $1', [id]);
  return row ? { bytes: await downloadObjectBytes(row.storage_key), contentType: row.content_type } : null;
}

// The listener's preferences as a page plays them, with the built-in sound when theirs is gone or can't be looked up:
// a problem here mustn't cost them the announcers
export async function engineBedConfigFor(settings: BroadcastSettings): Promise<EngineBedConfig> {
  if (settings.engineAsset === null) return engineBedConfig(settings);
  try {
    const rows = await query('SELECT 1 FROM racingcoach."EngineAudioAssets" WHERE id = $1', [settings.engineAsset]);
    return engineBedConfig(settings, rows.length > 0 ? settings.engineAsset : null);
  } catch (error) {
    console.error('Engine sound lookup error:', error);
    return engineBedConfig(settings, null);
  }
}

export async function readEngineBedConfig(userId: number): Promise<EngineBedConfig> {
  return engineBedConfigFor((await getRaceAnnouncerSettings(userId)).broadcast);
}
