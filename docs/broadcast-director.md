# Broadcast Director

Recorded clips in TV Broadcast Mode (`/tv`), run like a television production. The Director picks a clip, the Lead
Announcer introduces it, every TV watching that race session cuts to it together, and the broadcast returns to the live
track map. The broadcast is rendered entirely by the site; no external broadcasting software is involved.

Not to be confused with the **Commentary Director** (`src/lib/broadcastDirector.ts`), which decides what each listener's
announcers say. The Broadcast Director uses its priorities and intensities rather than having its own.

## How it works

```
Admin page ─ upload ─► object storage (presigned PUT)
                └────► videoProcessing.ts (ffprobe; ffmpeg when needed) ─► "BroadcastVideos".status = ready

videoDirectorRuntime.ts, one Director per race session, ticked 4 times a second while anyone watches
  ├─ videoDirector.ts            the rules: a state machine with no I/O or timers
  ├─ videoDirectorConditions.ts  how lively the race is, from classify / intensityFor
  ├─ raceAnnouncerLines + synthesizeSpeech    the lines, per language and voice in use
  └─ "BroadcastDirectorEvents"   every state, so a clip on screen survives a restart

readTvState ─► each TV's picture of the race carries the Director's snapshot (SSE, or polling)
  ├─ BroadcastVideoSwitcher      the clip over the map, which stays mounted and live
  └─ useTvCommentary             the sequence's lines at their set times
```

**States**: `LIVE` → `CLIP_SELECTED` (reserved, file checked) → `CLIP_PRELOADING` (3 s for TVs to buffer; lines being
written and voiced) → `INTRO_PENDING` (commentary held, waiting for what's playing to finish) → `INTRO_PLAYING` →
`TRANSITION_TO_VIDEO` → `VIDEO_PLAYING` → `TRANSITION_TO_LIVE` → `LIVE`. Anything that goes wrong goes through `RECOVERY`
(2 s) to `LIVE`.

**One timeline**: when the introduction is scheduled, every time in the sequence is fixed as an absolute server timestamp,
from the audio's measured length (the longest voicing, as viewers may have different languages and voices). A TV's own
audio or video events never move it. Each TV works out the server's clock from the pictures it receives, seeks to the
shared position when joining late, and corrects drift (a 5% speed nudge over 0.2 s, a seek over 0.75 s).

**Snapshots, not events**: each picture of the race has the Director's whole current state, numbered, so reconnects, late
joiners and duplicates need nothing special, and an older snapshot arriving late is ignored (`isNewerSnapshot`).

**Commentary**: normal commentary is held from `INTRO_PENDING` until the sequence's last line ends (`commentate`'s `held`).
Held events aren't lost: the TV asks again afterwards and the Commentary Director drops what's gone stale. A P0 moment gets
through, cancels a clip not yet on screen, and cuts straight back from one that is. The Lead introduces and hands back; the
Color Announcer may add a remark during a clip of 5 s or more, left out if it wouldn't fit.

**What the announcers may say**: they can't see the video, so they get the category and the clip's own metadata only, and
lines go through the same factual check as all commentary. A line naming a driver from the live session is dropped unless
the clip's metadata names them. Without the AI, the introduction and hand back use fixed wording in the dictionaries
(`tv.director`); the remark during the clip is left out.

**Scheduling**: a clip is due the minimum interval after the last one when the race is quiet (intensity 1), halfway to the
maximum at intensity 2, at the maximum at 3, and not at 4 or more. The maximum is a target, not a deadline. No clips in the
race's opening, final laps or after the finish, or within 15 s of a P0/P1 moment. The same clip and category are avoided while
there are alternatives. A clip tied to a track only plays at that track, and is favoured there. Play Video Now skips the
schedule, not the sequence.

## Failures

| What happens | What the Director does |
| --- | --- |
| Category empty, or nothing eligible | Nothing is announced; looks again in 30 s |
| File missing | Checked before anything is announced; `RECOVERY` |
| Every TV fails to load the clip | Dropped unannounced if not yet on screen, ended if it is |
| One TV fails or buffers over 3 s | That TV shows its map; the others carry on |
| AI fails | Fixed wording |
| Speech fails for every voice | No introduction: no clip when one is required, else the clip plays silently |
| Announcers still talking, or lines not ready, after 25 s | Given up |
| A failed clip | The next waits a full interval, so it can't loop |
| Server restart with a clip on screen | Carries on the same schedule, without its remaining commentary |
| Server restart before the cut | Dropped, `failure_reason` `serverRestarted` |
| Nobody watching for 20 s | The session ends |
| Database down mid clip | The schedule is already with the TVs; the Director keeps time |

## Setting it up on Render

1. **Create a bucket.** Cloudflare R2 is recommended, as serving video from it has no egress fees; any S3-compatible store
   works. Keep it private. Create an access key limited to that bucket.
2. **Allow uploads from the site** with a CORS rule on the bucket, or browsers can't upload to it:
   ```json
   [{ "AllowedOrigins": ["https://racingcoach.app"], "AllowedMethods": ["PUT", "GET", "HEAD"], "AllowedHeaders": ["Content-Type"], "ExposeHeaders": ["ETag"], "MaxAgeSeconds": 3600 }]
   ```
3. **Set the environment variables** on the web service:
   - `BROADCAST_VIDEO_S3_ENDPOINT` (e.g. `https://<account>.r2.cloudflarestorage.com`)
   - `BROADCAST_VIDEO_S3_BUCKET`
   - `BROADCAST_VIDEO_S3_ACCESS_KEY_ID`, `BROADCAST_VIDEO_S3_SECRET_ACCESS_KEY`
   - `BROADCAST_VIDEO_S3_REGION` (optional, default `auto`)
   - `BROADCAST_VIDEO_TRANSCODE=off` (optional): refuse clips needing a transcode rather than running ffmpeg on the web server
4. **Deploy.** The Dockerfile now installs ffmpeg, which makes the image larger. Tables are created on the first request.

Until the bucket is set up the Director doesn't run and the Admin page says what's missing; nothing changes on `/tv`.

**Transcoding** runs on the web server, one clip at a time, at the lowest CPU priority on one thread, and waits while anyone
is watching a broadcast. It can still use several hundred MB of memory, which could restart a small instance, so upload H.264
MP4 with AAC where you can: those skip it. **One instance**: like Live Racing, the Director lives in the server's memory.

**Cost**: each clip is one AI call per language in use, plus up to three speech calls per voice in use, only while a TV is
watching. These calls are made for no user, so they use the Admin category's `raceAnnouncer` model and aren't in `"AiUsage"` or
any account's rate limit. Video goes straight from storage to the TV, not through Render.

## Limits

- Only a clip's own lines are on the shared timeline. Normal commentary stays per listener, as each has their own language,
  voices and preferences, so two TVs don't speak the same normal commentary at the same moment.
- A viewer who joins after a line starts more than 1.2 s ago doesn't hear it; a viewer joining after the lines were voiced gets
  their language's audio if there is one, and silence otherwise.
- A clip's length is trusted from ffprobe, or from the Admin page when typed there.
- TVs need Start Broadcast for sound. Clips still play, muted, without it.

## Testing

- `npm run test:video-director`: the rules, selection, scheduling, intensity, the controls, sync arithmetic, recovery.
- `npm run test:e2e`, `e2e/broadcast-director.spec.ts`: real browsers, storage and ffmpeg: uploads into all eight categories,
  transcoding, two TVs cutting together, reload mid clip, the controls, automatic mode, missing and unplayable files. Its header
  lists what it needs; it's skipped without them. Speech and AI are stood in for, so nothing reaches a real service.

### Not tested by those: check on the first deploy

- [ ] R2 (or your store) with real keys: upload, preview, and the CORS rule
- [ ] A real introduction in the ElevenLabs voices, and that its timing feels right
- [ ] Real AI lines read well, in each language
- [ ] **On the Fire TV**: the clip plays smoothly, the cut is clean, the map is live afterwards, and the remote still responds
- [ ] A clip with Audio enabled and Allow video audio on: ducked under the announcers on the Fire TV
- [ ] A long race: clips don't interrupt big moments, and the spacing feels right. Adjust on the Admin page
