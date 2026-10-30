import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { isVideoCategory, MAX_VIDEO_BYTES, VIDEO_CATEGORIES, type VideoCategory } from './broadcastVideoCategories';
import { query } from './db';
import { deleteVideoObject, presignVideoUpload, videoObjectSize } from './objectStorage';
import { DEFAULT_DIRECTOR_SETTINGS, parseDirectorSettings, type DirectorSettings, type DirectorVideo } from './videoDirector';
import { ensureUserSchema } from './users';

// The Broadcast Video Library (the Admin page's section, src/components/BroadcastVideoLibrary.tsx): each clip's details in
// racingcoach."BroadcastVideos", its file in object storage (src/lib/objectStorage.ts). A file goes straight from the
// browser to storage with a presigned URL; once it's there, src/lib/videoProcessing.ts checks it and transcodes it if it
// must, and only then is it status ready, which is all the Broadcast Director ever picks.

export type VideoStatus = 'uploading' | 'processing' | 'transcoding' | 'ready' | 'failed';

export type LibraryVideo = {
  id: number;
  title: string;
  description: string;
  category: VideoCategory;
  trackId: number | null;
  track: string | null;
  carId: number | null;
  car: string | null;
  fileName: string;
  sizeBytes: number | null;
  status: VideoStatus;
  statusDetail: string | null;
  durationSeconds: number | null;
  clipStartSeconds: number;
  clipEndSeconds: number | null;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  audioEnabled: boolean;
  priority: number;
  selectionWeight: number;
  enabled: boolean;
  cameraPerspective: string;
  sessionInfo: string;
  commentaryContext: string;
  createdAt: string;
};

const SELECT_VIDEO = `SELECT v.*, t.track_name AS track, t.config_name AS track_config, t.track_key AS track_key, c.car_name AS car
  FROM racingcoach."BroadcastVideos" v
  LEFT JOIN racingcoach."Tracks" t ON t.id = v.track_id
  LEFT JOIN racingcoach."Cars" c ON c.id = v.car_id`;

type VideoRow = Record<string, unknown>;

const trackLabel = (row: VideoRow) => (row.track ? (row.track_config ? `${row.track} (${row.track_config})` : (row.track as string)) : null);

function toLibraryVideo(row: VideoRow): LibraryVideo {
  return {
    id: row.id as number,
    title: row.title as string,
    description: row.description as string,
    category: row.category as VideoCategory,
    trackId: (row.track_id as number | null) ?? null,
    track: trackLabel(row),
    carId: (row.car_id as number | null) ?? null,
    car: (row.car as string | null) ?? null,
    fileName: row.file_name as string,
    sizeBytes: row.size_bytes == null ? null : Number(row.size_bytes),
    status: row.status as VideoStatus,
    statusDetail: (row.status_detail as string | null) ?? null,
    durationSeconds: (row.duration_seconds as number | null) ?? null,
    clipStartSeconds: row.clip_start_seconds as number,
    clipEndSeconds: (row.clip_end_seconds as number | null) ?? null,
    width: (row.width as number | null) ?? null,
    height: (row.height as number | null) ?? null,
    videoCodec: (row.video_codec as string | null) ?? null,
    audioCodec: (row.audio_codec as string | null) ?? null,
    audioEnabled: row.audio_enabled as boolean,
    priority: row.priority as number,
    selectionWeight: row.selection_weight as number,
    enabled: row.enabled as boolean,
    cameraPerspective: row.camera_perspective as string,
    sessionInfo: row.session_info as string,
    commentaryContext: row.commentary_context as string,
    createdAt: (row.created_at as Date).toISOString(),
  };
}

const optionalText = (max: number) => z.string().trim().max(max).optional();

// The details an admin can set; duration, clip times and weights are checked against each other below
export const videoDetailsSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: optionalText(2000),
  category: z.enum(VIDEO_CATEGORIES),
  trackId: z.number().int().positive().nullable().optional(),
  carId: z.number().int().positive().nullable().optional(),
  durationSeconds: z.number().positive().max(24 * 3600).nullable().optional(),
  clipStartSeconds: z.number().min(0).max(24 * 3600).optional(),
  clipEndSeconds: z.number().positive().max(24 * 3600).nullable().optional(),
  audioEnabled: z.boolean().optional(),
  priority: z.number().int().min(0).max(10).optional(),
  selectionWeight: z.number().min(0).max(100).optional(),
  enabled: z.boolean().optional(),
  cameraPerspective: optionalText(200),
  sessionInfo: optionalText(500),
  commentaryContext: optionalText(1000),
});
export type VideoDetails = z.infer<typeof videoDetailsSchema>;

export const newVideoSchema = videoDetailsSchema.extend({
  fileName: z.string().trim().min(1).max(300),
  sizeBytes: z.number().int().positive().max(MAX_VIDEO_BYTES),
  contentType: z.string().trim().max(100).optional(),
});

export class ClipTimesError extends Error {}

function checkClipTimes(start: number, end: number | null | undefined, duration: number | null | undefined): void {
  if (end != null && end <= start) throw new ClipTimesError('clipEndBeforeStart');
  if (duration != null && start >= duration) throw new ClipTimesError('clipStartPastEnd');
}

export async function listLibrary(): Promise<LibraryVideo[]> {
  await ensureUserSchema();
  const rows = await query(`${SELECT_VIDEO} ORDER BY v.category, v.created_at DESC`);
  return rows.map(toLibraryVideo);
}

export async function readVideo(id: number): Promise<LibraryVideo | null> {
  await ensureUserSchema();
  const [row] = await query(`${SELECT_VIDEO} WHERE v.id = $1`, [id]);
  return row ? toLibraryVideo(row) : null;
}

// The choices the library's Track and Car boxes offer
export async function readVideoOptions(): Promise<{ tracks: { id: number; name: string }[]; cars: { id: number; name: string }[] }> {
  await ensureUserSchema();
  const [tracks, cars] = await Promise.all([
    query<{ id: number; track_name: string; config_name: string | null }>('SELECT id, track_name, config_name FROM racingcoach."Tracks" ORDER BY track_name, config_name'),
    query<{ id: number; car_name: string }>('SELECT id, car_name FROM racingcoach."Cars" ORDER BY car_name'),
  ]);
  return {
    tracks: tracks.map((t) => ({ id: t.id, name: t.config_name ? `${t.track_name} (${t.config_name})` : t.track_name })),
    cars: cars.map((c) => ({ id: c.id, name: c.car_name })),
  };
}

// A new clip waiting for its file, and the presigned URL the browser uploads it to
export async function createVideo(input: z.infer<typeof newVideoSchema>, userId: number): Promise<{ video: LibraryVideo; uploadUrl: string; contentType: string }> {
  await ensureUserSchema();
  checkClipTimes(input.clipStartSeconds ?? 0, input.clipEndSeconds, input.durationSeconds);
  const extension = input.fileName.split('.').pop()?.toLowerCase() ?? 'mp4';
  const key = `broadcast-videos/${randomUUID()}.${extension}`;
  const contentType = input.contentType?.startsWith('video/') ? input.contentType : 'video/mp4';
  const uploadUrl = await presignVideoUpload(key, contentType);
  const [row] = await query<{ id: number }>(
    `INSERT INTO racingcoach."BroadcastVideos"
       (title, description, category, track_id, car_id, storage_key, file_name, size_bytes, duration_seconds, duration_set_by_admin,
        clip_start_seconds, clip_end_seconds, audio_enabled, priority, selection_weight, enabled, camera_perspective, session_info,
        commentary_context, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20) RETURNING id`,
    [
      input.title,
      input.description ?? '',
      input.category,
      input.trackId ?? null,
      input.carId ?? null,
      key,
      input.fileName,
      input.sizeBytes,
      input.durationSeconds ?? null,
      input.durationSeconds != null,
      input.clipStartSeconds ?? 0,
      input.clipEndSeconds ?? null,
      input.audioEnabled ?? false,
      input.priority ?? 0,
      input.selectionWeight ?? 1,
      input.enabled ?? true,
      input.cameraPerspective ?? '',
      input.sessionInfo ?? '',
      input.commentaryContext ?? '',
      userId,
    ]
  );
  return { video: (await readVideo(row.id))!, uploadUrl, contentType };
}

// The browser finished uploading: checks the file arrived at an allowed size and queues it for processing. False when
// the file isn't there.
export async function markUploaded(id: number): Promise<'queued' | 'missing' | 'tooLarge' | 'notFound'> {
  await ensureUserSchema();
  const [row] = await query<{ storage_key: string; status: string }>('SELECT storage_key, status FROM racingcoach."BroadcastVideos" WHERE id = $1', [id]);
  if (!row) return 'notFound';
  if (row.status !== 'uploading') return 'queued';
  const size = await videoObjectSize(row.storage_key);
  if (size === null) return 'missing';
  if (size > MAX_VIDEO_BYTES) {
    await deleteVideoObject(row.storage_key).catch((error) => console.error('Broadcast video delete error:', error));
    await query(`UPDATE racingcoach."BroadcastVideos" SET status = 'failed', status_detail = 'tooLarge', updated_at = now() WHERE id = $1`, [id]);
    return 'tooLarge';
  }
  await query(`UPDATE racingcoach."BroadcastVideos" SET status = 'processing', size_bytes = $2, status_detail = NULL, updated_at = now() WHERE id = $1`, [id, size]);
  return 'queued';
}

export async function updateVideo(id: number, patch: Partial<VideoDetails>): Promise<LibraryVideo | null> {
  await ensureUserSchema();
  const current = await readVideo(id);
  if (!current) return null;
  const next = {
    title: patch.title ?? current.title,
    description: patch.description ?? current.description,
    category: patch.category ?? current.category,
    trackId: patch.trackId === undefined ? current.trackId : patch.trackId,
    carId: patch.carId === undefined ? current.carId : patch.carId,
    durationSeconds: patch.durationSeconds === undefined ? current.durationSeconds : patch.durationSeconds,
    clipStartSeconds: patch.clipStartSeconds ?? current.clipStartSeconds,
    clipEndSeconds: patch.clipEndSeconds === undefined ? current.clipEndSeconds : patch.clipEndSeconds,
    audioEnabled: patch.audioEnabled ?? current.audioEnabled,
    priority: patch.priority ?? current.priority,
    selectionWeight: patch.selectionWeight ?? current.selectionWeight,
    enabled: patch.enabled ?? current.enabled,
    cameraPerspective: patch.cameraPerspective ?? current.cameraPerspective,
    sessionInfo: patch.sessionInfo ?? current.sessionInfo,
    commentaryContext: patch.commentaryContext ?? current.commentaryContext,
  };
  checkClipTimes(next.clipStartSeconds, next.clipEndSeconds, next.durationSeconds);
  await query(
    `UPDATE racingcoach."BroadcastVideos" SET title = $2, description = $3, category = $4, track_id = $5, car_id = $6, duration_seconds = $7,
       duration_set_by_admin = duration_set_by_admin OR $8, clip_start_seconds = $9, clip_end_seconds = $10, audio_enabled = $11, priority = $12,
       selection_weight = $13, enabled = $14, camera_perspective = $15, session_info = $16, commentary_context = $17, updated_at = now()
     WHERE id = $1`,
    [
      id,
      next.title,
      next.description,
      next.category,
      next.trackId,
      next.carId,
      next.durationSeconds,
      patch.durationSeconds != null,
      next.clipStartSeconds,
      next.clipEndSeconds,
      next.audioEnabled,
      next.priority,
      next.selectionWeight,
      next.enabled,
      next.cameraPerspective,
      next.sessionInfo,
      next.commentaryContext,
    ]
  );
  return readVideo(id);
}

// Removes the clip and its file; a file that's already gone is no reason to keep the row
export async function deleteVideo(id: number): Promise<boolean> {
  await ensureUserSchema();
  const rows = await query<{ storage_key: string }>('DELETE FROM racingcoach."BroadcastVideos" WHERE id = $1 RETURNING storage_key', [id]);
  if (rows.length === 0) return false;
  await deleteVideoObject(rows[0].storage_key).catch((error) => console.error('Broadcast video file delete error:', error));
  return true;
}

export async function readVideoStorageKey(id: number): Promise<string | null> {
  await ensureUserSchema();
  const [row] = await query<{ storage_key: string }>(`SELECT storage_key FROM racingcoach."BroadcastVideos" WHERE id = $1`, [id]);
  return row?.storage_key ?? null;
}

// What the Director may pick from: ready, enabled, and with a known length
export async function readPlayableVideos(): Promise<DirectorVideo[]> {
  await ensureUserSchema();
  const rows = await query(`${SELECT_VIDEO} WHERE v.status = 'ready' AND v.enabled AND v.duration_seconds IS NOT NULL`);
  return rows.map((row) => ({
    id: row.id as number,
    title: row.title as string,
    description: row.description as string,
    category: row.category as VideoCategory,
    trackKey: (row.track_key as string | null) ?? null,
    track: trackLabel(row),
    car: (row.car as string | null) ?? null,
    durationSeconds: row.duration_seconds as number,
    clipStartSeconds: row.clip_start_seconds as number,
    clipEndSeconds: (row.clip_end_seconds as number | null) ?? null,
    audioEnabled: row.audio_enabled as boolean,
    priority: row.priority as number,
    selectionWeight: row.selection_weight as number,
    cameraPerspective: row.camera_perspective as string,
    sessionInfo: row.session_info as string,
    commentaryContext: row.commentary_context as string,
  }));
}

// The Director's settings, in "SiteSettings", key broadcast_director

const SETTINGS_KEY = 'broadcast_director';
const SETTINGS_CACHE_MS = 5000;
const settingsStore = globalThis as unknown as { directorSettings?: { at: number; value: DirectorSettings } };

export async function getDirectorSettings(fresh = false): Promise<DirectorSettings> {
  const cached = settingsStore.directorSettings;
  if (!fresh && cached && Date.now() - cached.at < SETTINGS_CACHE_MS) return cached.value;
  await ensureUserSchema();
  const [row] = await query<{ value: string }>('SELECT value FROM racingcoach."SiteSettings" WHERE key = $1', [SETTINGS_KEY]);
  let parsed: unknown = null;
  try {
    parsed = row ? JSON.parse(row.value) : null;
  } catch {
    console.error('Broadcast Director settings are not valid JSON; using the defaults');
  }
  const value = parseDirectorSettings(parsed, DEFAULT_DIRECTOR_SETTINGS);
  settingsStore.directorSettings = { at: Date.now(), value };
  return value;
}

export async function setDirectorSettings(raw: unknown, userId: number): Promise<DirectorSettings> {
  const settings = parseDirectorSettings(raw, await getDirectorSettings(true));
  await query(
    `INSERT INTO racingcoach."SiteSettings" (key, value, updated_by) VALUES ($1, $2, $3)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [SETTINGS_KEY, JSON.stringify(settings), userId]
  );
  settingsStore.directorSettings = { at: Date.now(), value: settings };
  return settings;
}

export { isVideoCategory };

// Playback history

export type VideoHistoryRow = {
  id: number;
  sessionKey: string;
  videoId: number | null;
  category: string;
  title: string;
  trigger: string;
  status: string;
  introductionText: string | null;
  failureReason: string | null;
  selectedAt: string;
  startedAt: string | null;
  endedAt: string | null;
};

export async function readVideoHistory(limit = 15): Promise<VideoHistoryRow[]> {
  await ensureUserSchema();
  const rows = await query(`SELECT * FROM racingcoach."BroadcastVideoHistory" ORDER BY selected_at DESC, id DESC LIMIT $1`, [limit]);
  return rows.map((row) => ({
    id: Number(row.id),
    sessionKey: row.session_key as string,
    videoId: (row.video_id as number | null) ?? null,
    category: row.category as string,
    title: row.title as string,
    trigger: row.trigger as string,
    status: row.status as string,
    introductionText: (row.introduction_text as string | null) ?? null,
    failureReason: (row.failure_reason as string | null) ?? null,
    selectedAt: (row.selected_at as Date).toISOString(),
    startedAt: row.started_at ? (row.started_at as Date).toISOString() : null,
    endedAt: row.ended_at ? (row.ended_at as Date).toISOString() : null,
  }));
}

// The newest clips shown anywhere, oldest first, so a new session doesn't open with what the last one just showed
export async function readRecentlyPlayed(limit: number): Promise<{ videoId: number; category: VideoCategory }[]> {
  await ensureUserSchema();
  const rows = await query<{ video_id: number; category: string }>(
    `SELECT video_id, category FROM racingcoach."BroadcastVideoHistory" WHERE video_id IS NOT NULL ORDER BY selected_at DESC, id DESC LIMIT $1`,
    [limit]
  );
  return rows.reverse().flatMap((r) => (isVideoCategory(r.category) ? [{ videoId: r.video_id, category: r.category }] : []));
}

const EVENTS_KEPT_DAYS = 30;
// A clip whose server went away without saying what became of it
const UNFINISHED_AFTER_MINUTES = 10;

export async function purgeDirectorLog(): Promise<void> {
  await ensureUserSchema();
  await query(`DELETE FROM racingcoach."BroadcastDirectorEvents" WHERE created_at < now() - make_interval(days => $1)`, [EVENTS_KEPT_DAYS]);
  await query(
    `UPDATE racingcoach."BroadcastVideoHistory" SET status = 'failed', failure_reason = 'interrupted', ended_at = now()
     WHERE ended_at IS NULL AND selected_at < now() - make_interval(mins => $1)`,
    [UNFINISHED_AFTER_MINUTES]
  );
}
