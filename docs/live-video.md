# Live Video (OBS + Cloudflare Stream)

OBS live video on the Live Racing page and in TV Broadcast Mode (`/tv`). OBS only captures and sends the picture and the
game's sound; the site picks the camera, keeps the Race Announcers, synchronizes the map and graphics, and plays the
Broadcast Director's recorded clips as before.

```
OBS (gaming PC) ── RTMPS ──► Cloudflare Stream Live input ── HLS ──► each viewer's browser (hls.js / Safari)
                                     ▲  status (API + lifecycle, cached 10 s on the server)
Render web service ──────────────────┘
  ├─ Broadcast Source Manager  src/lib/liveVideo/broadcastSource.ts (rules) + broadcastSourceRuntime.ts (one per race)
  │     camera: TRACK_MAP | OBS_LIVE, the same for every TV of that race, switching at a server time (switchAt)
  ├─ Broadcast Director (unchanged) VIDEO_CLIP over whichever camera is on
  └─ TV picture (readTvState) carries focus.liveVideo: { source, stream (playback URL while live), sync, obsVolume, duckLevel }
```

Off by default. Nothing reaches any page, and no Cloudflare request is made, until an Admin turns **Live video on** in the
Admin page's **Live Video & Broadcast Control** and the environment has at least `CLOUDFLARE_STREAM_CUSTOMER_CODE`. The
Site Settings emergency stop (Paid AI, speech and map services) also stops the live video, as delivery is billed.

## Pieces

| Part | Where |
| --- | --- |
| Rules: camera choice, shot rules, snapshots (pure) | `src/lib/liveVideo/broadcastSource.ts` |
| Timeline: buffer, interpolation, delay, commentary timing (pure) | `src/lib/liveVideo/broadcastTimeline.ts` |
| Cloudflare helpers: statuses, URLs, token claims (pure) | `src/lib/liveVideo/streamRules.ts` |
| Moments from race events (reuses the Commentary Director's `classify`) | `src/lib/liveVideo/sourceMoments.ts` |
| Cloudflare API, status cache, signed tokens (server only) | `src/lib/liveVideo/cloudflareStream.ts` |
| Runtime: one camera per race session, viewers, TV reports | `src/lib/liveVideo/broadcastSourceRuntime.ts` |
| Tables and settings | `src/lib/liveVideoDb.ts` |
| Player | `src/components/LiveOBSPlayer.tsx` |
| TV camera (map + player, both mounted) | `src/components/TvBroadcastStage.tsx`, `TvLiveVideoDiagnostics.tsx`, `useBroadcastTimeline.ts` |
| Live Racing view switch and synchronized map | `src/components/LiveRacing.tsx`, `useLiveRacingVideo.ts` |
| Admin | `src/components/LiveVideoControl.tsx` |

### Routes

| Route | Who | What |
| --- | --- | --- |
| `GET /api/live/video` | signed-in users (30/min) | streams of drivers the user may watch on Live Racing, playback URL only while live |
| `POST /api/tv/live-video/report` | paired TVs (20/min) | the TV's player and timeline figures, kept in memory 5 min |
| `GET`/`PUT`/`POST /api/admin/live-video` | Admins (404 otherwise) | overview; settings; camera control `{ sessionKey, action: select, source }` or `{ action: auto }` |
| `POST /api/admin/live-video/streams` | Admins (10 inputs/hour) | add a stream: `{ email, name, requireSigned, inputId? }`, creates the input through the API when no ID is given |
| `PATCH`/`DELETE /api/admin/live-video/streams/[id]` | Admins | turn on/off, require signed URLs, rename; remove (`?deleteInput=1` also deletes an input the site created) |

### Database

Created on first use by `ensureLiveVideoSchema` (additive, no migration step to run):

- `"LiveVideoStreams"`: `id`, `user_id` (the driver whose racing it shows, `ON DELETE CASCADE`; one stream per driver),
  `name`, `input_id` (the live input's UID, 32 hex), `require_signed`, `enabled`, `created_via` (`api` or `registered`),
  `created_by`, timestamps. At most 10 rows (`MAX_LIVE_STREAMS`). Never a stream key, token or URL with a token.
- `"BroadcastSourceStates"`: `session_key` → the camera state (JSONB), so a manual choice survives a restart; purged after a day.
- Settings: `"SiteSettings"` key `live_video` (JSON, `parseLiveVideoSettings`).

Telemetry is never stored for synchronization: the delay buffer lives in each viewer's browser.

## Who sees a stream

The same rule as the Live Racing page's map, so nothing new is invented: a viewer gets a driver's stream when they may watch
that driver (`watchableDrivers`: themselves, Coaches and Admins everyone, everyone Coaches, and those the driver added under
Who Can Watch Me). A TV gets the stream of the driver it follows, else of another driver in the same iRacing subsession the
TV's account may watch. Live Racing is for signed-in users of every level, so there's no membership gate on watching; the
Race Announcers keep theirs (Silver, Gold, Admins).

## Choosing the camera

`sourceTick` runs as TVs ask for their picture (about once a second each; nothing runs while no TV watches):

1. Live video off → map. Manual mode → the Admin's choice. Automatic, with the **rotation** on (the default) → OBS for
   the OBS turn (`rotation.obsSeconds`, 75 s), then the map for the map turn (`rotation.mapSeconds`, 20 s), then one of
   the Broadcast Director's rotation clips, then OBS again (`rotationCamera`). The cycle restarts at each clip's return
   (the Director's `returnAt`, else its last clip's end, shared through `rotationLink.ts`), and while the camera rotates
   the Director spaces its rotation clips by the OBS and map turns (its `rotationMapSeconds` replaced by their sum) and
   rotates outside races too, so the three take turns and OBS is on screen
   `obsSeconds / (obsSeconds + mapSeconds + clip)` of the time (the Admin page shows the share; 60% with 30 s clips).
   No clips (the Director's Rotation off, or none to play): OBS and the map alone. Only a big moment interrupts the
   rotation: a P0 or P1 moment whose preferred camera is OBS (rule 2 still applies), or a P0 moment whose camera is the
   map. Reasons `rotationObs` / `rotationMap`. With the rotation off → the preferred camera of the most important race
   moment of the last `momentSeconds` (from the race events, by the Commentary Director's priorities), else the camera
   for "cars spread across the circuit".
2. **The OBS camera's subject is unknown unless the Admin says otherwise.** For moments about particular cars (battle,
   overtake, incident, pit stop) OBS is only picked when *What the OBS camera shows* is *The stream's own driver's car* and
   that car is involved; otherwise the map, which shows every car (reason `cameraSubjectUnknown` / `cameraNotOnAction`).
   Whole-race moments (start, final lap, finish) can go to OBS either way.
3. OBS not live for `offlineGraceSeconds` → map (`obsOffline`), even in manual mode, back to OBS when it returns.
4. Shot rules: a shot lasts `minShotSeconds`; nothing switches within `cooldownSeconds`; a P0 moment skips the minimum
   shot but not the cooldown. Manual choices, turning off and OBS going away apply at once.
5. Each switch is numbered and set `switchLeadMs` (1.2 s) ahead, so every TV (which hears within a second) cuts together.

Recorded clips are untouched: the Broadcast Director decides them as before and they cover whichever camera is on
(`effectiveSource`). Play Video Now in the Broadcast Director section is the manual "select prerecorded clip".

## Synchronization

### The clocks

| Clock | What it is | Where |
| --- | --- | --- |
| Simulator time | iRacing's `SessionTime` | the collector's input samples |
| Capture time | not sent: the collector has no wall-clock stamp of its own | — |
| Server receipt time | when the site got the collector's update | `receivedAt`; the TV picture's `at` |
| Video capture time | not available from OBS | — |
| Video presentation time | wall-clock time of the frame on screen, **only if** the HLS playlist has `EXT-X-PROGRAM-DATE-TIME` | hls.js `playingDate` |
| Player latency | hls.js's estimate of how far behind the live edge it plays | hls.js `latency` |
| Browser time | `Date.now()` converted to server time by the clock offset each picture gives | `useTvFeed` |
| Commentary time | event's server time + the delay | `commentaryNotBefore` |

Cloudflare's docs don't say their live HLS carries `EXT-X-PROGRAM-DATE-TIME`. When it does, the delay is **measured**
(server now − frame time); when it doesn't, it's the player's **estimate** plus the Admin's offset; in manual mode it's the
**calibrated** offset alone. Every figure shown says which. Nothing claims a precision it didn't measure.

### How it works

- **Off** (the default, and always on the Live Racing page unless the viewer ticks *Sync map to video*): live, as before.
  Nobody who hasn't turned it on is delayed.
- **TV** (`useBroadcastTimeline`): keeps the last `maxBufferMs` + 5 s of pictures (bounded: at most 600), each stamped with its
  server time. It shows the picture from `delay` ago: map, leaderboard, header, events, inputs. Between pictures the map moves
  each car at the pace it really went to the next picture (already in the buffer), using the map's own dead reckoning, so
  it's smooth without redrawing React state 60 times a second. The delay is **held steady** (`holdDelay`): every change of
  it changes how fast the delayed timeline plays (easing it 150 ms every 250 ms played it at 0.4×-1.6×), while the map
  moves the cars at their real pace, so they jumped at every picture. hls.js's estimate never sits still (it falls with
  each segment and creeps up until the next, and stalls add to it), so the delay is taken once, from the median of the
  last 15 readings, and moved only when it has been more than 2 s off for 5 s, then gliding at 5% of real time. A change
  of the Admin page's Offset is the viewer's own adjustment and applies at once; so does a jump of over 15 s (a new
  stream). Duplicates, out-of-order and too-old pictures are counted, not shown twice.
- The Broadcast Director's clip times and the camera's `switchAt` are not delayed: they're already absolute times.
- **Commentary** is asked for as soon as the live event arrives (so the AI and speech use up the delay rather than adding
  to it), and each line waits in the queue until *event time + delay* (`notBefore` in `CommentaryQueue`). Its 20 s wait and
  its moment's expiry count from then. The event's own time is used once; arrival time is never added again.
- **Live Racing**: *Sync map to video* (in OBS live or Split view) delays that page's tracks (maps, leaderboard, lap details)
  the same way, from the page's own player; announcers, radio and the Driver Inputs stay live.

### What's realistic

- Each viewer's player has its own HLS delay (it depends on the segment it joined at and its network), so two TVs can show
  the video a few seconds apart. Each TV synchronizes its own map to its own video; **there's no frame-accurate shared
  playout across viewers**, and none is claimed.
- With a measured frame time, the error left is the encoder-to-Cloudflare part (OBS's encode and upload, typically about
  a second), plus telemetry's own ~1 s (half-second updates plus the network), which the offset trims.
- With only the estimate, expect a few seconds of error until calibrated; with a calibration, it holds while the stream's
  latency stays the same (a reconnect or a different player buffer changes it).

**Measuring it**: drive across the start/finish line and watch the TV: the moment the video shows the car crossing vs the
moment the map's dot crosses is the error. The TV's Settings > Live video and the Admin page's TV diagnostics show the
latency, the delay and its basis, the measured error when there is one, the buffer, late/out-of-order/duplicate samples and
stalls. *Sync degraded* shows when there's no timing at all, the delay was capped at the buffer, or the buffer is still filling.

### Calibration (Admin page)

1. Set **Synchronization** to manual, tick Synchronized broadcast, and pick the stream under Calibration (the preview plays
   only while picked: its minutes are billed too).
2. *Use as offset* copies the player's latency into the offset as a starting point.
3. With a TV (or the Live Racing page in Split view with Sync map to video) watching, nudge the offset until a line crossing
   shows on the map when it does in the video. Positive delays the map more. Save.

In automatic mode the offset is added to the player's figure, so it trims a constant error instead.

## Audio

- The announcers keep their own audio element (unchanged), so they carry on across every switch, clip and reconnect.
- OBS sound plays only while OBS is on screen, at **OBS volume** × the TV's volume, lowered to **OBS volume while an
  announcer speaks** under their lines. The TV's Settings has *Video sound* on/off; Mute mutes everything.
- Recorded clips' sound follows the Broadcast Director's settings, as before.
- **Don't capture the announcers in OBS.** If OBS captures desktop audio while a RacingCoach page is playing on the same PC,
  viewers hear the announcers twice (once from their own page, once inside the video, seconds later). Capture only the game
  (Application Audio Capture of iRacing/ACC), or keep RacingCoach pages muted on the gaming PC.

## Failures

| What happens | What the viewer sees |
| --- | --- |
| OBS not running / not connected | Map; the Live Racing view shows the offline card |
| OBS drops mid-race | After `offlineGraceSeconds`, the map, with "Live video offline: showing the track map"; back to OBS when it returns |
| Player error (network, expired token, decoder) | The player starts again with growing waits (1-15 s); the TV shows its map meanwhile |
| Buffering over 5 s on one TV | That TV shows its map; others carry on |
| Cloudflare API down | Status from the lifecycle endpoint, else ERROR: map |
| Telemetry stops | Map and leaderboard as before (offline after 15 s); the buffer just stops growing |
| No sync timing | Delay from the calibration, or none; *Sync degraded* |
| AI or speech slow | Commentary already waits for the delay; a line later than its moment is dropped as before |
| Viewer joins late or reconnects | Snapshots carry the whole state; an older one is ignored (`isNewerSource`) |
| Server restart | The camera and manual mode come back from `"BroadcastSourceStates"` (numbering jumps ahead) |

**One instance**: like Live Racing and the Broadcast Director, the camera state is in the server's memory and persisted
only for restarts. Running more than one web instance would need shared state (Postgres or Key Value) for the runtime.

## Costs

Cloudflare Stream (pricing page, 2026-11): ingest and encoding free; **delivery $1 per 1,000 minutes viewed**, every viewer
minute counted (player, HLS); storage $5 per 1,000 minutes a month, prepaid. Inputs the site creates have **recording off**,
so a live broadcast stores nothing. Stream itself is a paid subscription (the smallest storage plan); check the dashboard.

Every viewer pulls the same single transcode from Cloudflare's edge: one OBS upload however many watch. **A TV plays the
stream the whole time it's live**, also while the map is on screen (that's what makes switching instant), so its minutes are
its watch time; the Live Racing page only plays while its view is OBS live or Split; the Admin preview only while picked.

## Tests

- `npm run test:live-video`: the rules, shot timing, manual override, fallback, snapshots and restarts; the buffer
  (duplicates, out of order, bounds, interpolation across the line); the delay and its basis; commentary timing and the
  queue; Cloudflare statuses, URLs and RS256 tokens verified with a generated key; and source guards (Admin-only routes,
  capped bodies, no secrets in browser code, both TV layers mounted, the emergency stop and watch rule, the CSP).
- Not covered automatically (needs a real stream): the player against Cloudflare, Fire TV playback, real latency figures,
  whether Cloudflare's playlists carry `EXT-X-PROGRAM-DATE-TIME`, signed URLs on a live input. See the checklist below.

### First deploy checklist

- [ ] A Cloudflare live input plays on the Live Racing page (OBS live view), desktop and phone
- [ ] `/tv` cuts between map and OBS from the Admin buttons, with no rebuffer when cutting back to OBS
- [ ] OBS stopped: the TV goes to the map after a few seconds and back when restarted
- [ ] The player's latency line says *measured* or *estimated* (tells you whether `EXT-X-PROGRAM-DATE-TIME` is there)
- [ ] Calibrated sync: a start/finish crossing lines up within a second or two
- [ ] On the Fire TV: playback smooth, and memory holds over a long race with the player kept running
- [ ] If you turn on signed URLs: playback still works (Cloudflare signs tokens for the broadcast's video UID)
