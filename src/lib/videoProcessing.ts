import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { purgeDirectorLog } from './broadcastVideos';
import { query } from './db';
import { deleteVideoObject, downloadVideoObject, presignVideoPlayback, uploadVideoObject, videoObjectSize } from './objectStorage';
import { ensureUserSchema } from './users';

// Checks each uploaded broadcast video with ffprobe (in the Docker image), and transcodes what TVs can't play to H.264
// with AAC in an MP4. Works through "BroadcastVideos" rows with status processing or transcoding, so it carries on after a
// restart, one at a time on the web server, in a temp folder that's deleted after. A transcode runs at the lowest CPU
// priority on one thread, and waits while anyone is watching a broadcast, so it can't get in the way of a live race;
// BROADCAST_VIDEO_TRANSCODE=off turns it off, and a clip needing one then fails with a clear reason.

const CHECK_EVERY_MS = 15_000;
const PROBE_TIMEOUT_MS = 60_000;
const TRANSCODE_TIMEOUT_MS = 60 * 60_000;
const PURGE_EVERY_MS = 60 * 60_000;

const execFileAsync = promisify(execFile);

export type ProbeResult = {
  videoCodec: string | null;
  audioCodec: string | null;
  pixelFormat: string | null;
  container: string;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
};

type ProbeJson = {
  format?: { format_name?: string; duration?: string };
  streams?: { codec_type?: string; codec_name?: string; pix_fmt?: string; width?: number; height?: number; duration?: string }[];
};

// ffprobe's answer, as what the library keeps
export function parseProbe(json: ProbeJson): ProbeResult {
  const video = json.streams?.find((s) => s.codec_type === 'video');
  const audio = json.streams?.find((s) => s.codec_type === 'audio');
  const duration = Number(json.format?.duration ?? video?.duration);
  return {
    videoCodec: video?.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null,
    pixelFormat: video?.pix_fmt ?? null,
    container: json.format?.format_name ?? '',
    durationSeconds: Number.isFinite(duration) && duration > 0 ? duration : null,
    width: video?.width ?? null,
    height: video?.height ?? null,
  };
}

// Whether every browser the broadcast is built for plays it as it is: H.264 8-bit 4:2:0, with AAC or no sound, in an MP4
export function isPlayable(probe: ProbeResult): boolean {
  return (
    probe.videoCodec === 'h264' &&
    (probe.pixelFormat === 'yuv420p' || probe.pixelFormat === 'yuvj420p') &&
    (probe.audioCodec === null || probe.audioCodec === 'aac') &&
    probe.container.split(',').includes('mp4')
  );
}

const transcodingAllowed = () => process.env.BROADCAST_VIDEO_TRANSCODE?.trim().toLowerCase() !== 'off';

async function ffprobe(source: string): Promise<ProbeResult> {
  const { stdout } = await execFileAsync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', source], {
    timeout: PROBE_TIMEOUT_MS,
    maxBuffer: 4 * 1024 * 1024,
  });
  return parseProbe(JSON.parse(stdout) as ProbeJson);
}

function ffmpeg(input: string, output: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'nice',
      ['-n', '19', 'ffmpeg', '-y', '-nostdin', '-v', 'error', '-i', input, '-map', '0:v:0', '-map', '0:a:0?', '-threads', '1', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', output],
      { stdio: ['ignore', 'ignore', 'pipe'] }
    );
    let errors = '';
    child.stderr.on('data', (chunk) => {
      errors = (errors + String(chunk)).slice(-2000);
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), TRANSCODE_TIMEOUT_MS);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with ${code}: ${errors}`));
    });
  });
}

type Row = { id: number; storage_key: string; status: string; duration_set_by_admin: boolean };

async function saveProbe(row: Row, probe: ProbeResult, status: 'ready' | 'transcoding'): Promise<void> {
  await query(
    `UPDATE racingcoach."BroadcastVideos" SET status = $2, status_detail = NULL, video_codec = $3, audio_codec = $4, width = $5, height = $6,
       duration_seconds = CASE WHEN duration_set_by_admin THEN duration_seconds ELSE $7 END, updated_at = now() WHERE id = $1`,
    [row.id, status, probe.videoCodec, probe.audioCodec, probe.width, probe.height, probe.durationSeconds]
  );
}

async function fail(id: number, detail: string): Promise<void> {
  console.error(`Broadcast video ${id} failed: ${detail}`);
  await query(`UPDATE racingcoach."BroadcastVideos" SET status = 'failed', status_detail = $2, updated_at = now() WHERE id = $1`, [id, detail]);
}

async function probeUploaded(row: Row): Promise<void> {
  // The URL is signed, so ffprobe's error messages, which quote it, aren't kept
  let probe: ProbeResult;
  try {
    probe = await ffprobe(await presignVideoPlayback(row.storage_key));
  } catch (error) {
    const code = (error as { code?: string | number }).code;
    if (code === 'ENOENT') return fail(row.id, 'ffprobeMissing');
    console.error(`Broadcast video ${row.id} probe failed with code ${code}`);
    return fail(row.id, 'notAVideo');
  }
  if (!probe.videoCodec) return fail(row.id, 'notAVideo');
  if (isPlayable(probe)) {
    if (!probe.durationSeconds) return fail(row.id, 'noDuration');
    return saveProbe(row, probe, 'ready');
  }
  if (!transcodingAllowed()) return fail(row.id, 'needsTranscode');
  await saveProbe(row, probe, 'transcoding');
}

async function transcode(row: Row): Promise<void> {
  const folder = await mkdtemp(join(tmpdir(), 'broadcast-video-'));
  try {
    const input = join(folder, 'input');
    const output = join(folder, 'output.mp4');
    await downloadVideoObject(row.storage_key, input);
    await ffmpeg(input, output);
    const probe = await ffprobe(output);
    if (!isPlayable(probe) || !probe.durationSeconds) return await fail(row.id, 'transcodeFailed');
    const key = `broadcast-videos/${randomUUID()}.mp4`;
    await uploadVideoObject(key, output, 'video/mp4');
    const size = await videoObjectSize(key);
    await query(`UPDATE racingcoach."BroadcastVideos" SET storage_key = $2, size_bytes = $3 WHERE id = $1`, [row.id, key, size]);
    await saveProbe(row, probe, 'ready');
    await deleteVideoObject(row.storage_key).catch((error) => console.error('Broadcast video original delete error:', error));
    console.log(`Broadcast video ${row.id} transcoded`);
  } catch (error) {
    console.error(`Broadcast video ${row.id} transcode error:`, error);
    await fail(row.id, (error as { code?: string }).code === 'ENOENT' ? 'ffmpegMissing' : 'transcodeFailed');
  } finally {
    await rm(folder, { recursive: true, force: true }).catch(() => undefined);
  }
}

const store = globalThis as unknown as { broadcastVideoWorker?: { busy: boolean; started: boolean; purgedAt: number } };
const worker = (store.broadcastVideoWorker ??= { busy: false, started: false, purgedAt: 0 });

// One clip's next step, if any waits; true when it did one
export async function processNextVideo(): Promise<boolean> {
  if (worker.busy) return false;
  worker.busy = true;
  try {
    await ensureUserSchema();
    const [probing] = await query<Row>(
      `SELECT id, storage_key, status, duration_set_by_admin FROM racingcoach."BroadcastVideos" WHERE status = 'processing' ORDER BY updated_at LIMIT 1`
    );
    if (probing) {
      await probeUploaded(probing);
      return true;
    }
    const { directorViewerCount } = await import('./videoDirectorRuntime');
    if (directorViewerCount() > 0) return false;
    const [waiting] = await query<Row>(
      `SELECT id, storage_key, status, duration_set_by_admin FROM racingcoach."BroadcastVideos" WHERE status = 'transcoding' ORDER BY updated_at LIMIT 1`
    );
    if (!waiting) return false;
    await transcode(waiting);
    return true;
  } finally {
    worker.busy = false;
  }
}

// Started once per server (src/instrumentation.ts)
export function startVideoProcessing(): void {
  if (worker.started) return;
  worker.started = true;
  const timer = setInterval(() => {
    (async () => {
      if (await processNextVideo()) return;
      if (Date.now() - worker.purgedAt > PURGE_EVERY_MS) {
        worker.purgedAt = Date.now();
        await purgeDirectorLog();
      }
    })().catch((error) => console.error('Broadcast video processing error:', error));
  }, CHECK_EVERY_MS);
  timer.unref();
}
