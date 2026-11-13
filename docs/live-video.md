# Live Video (OBS + Cloudflare Stream)

OBS live video on the Live Racing page and in TV Broadcast Mode (`/tv`). OBS only captures and sends the picture and the
game's sound; the site keeps the Race Announcers, synchronizes the map and graphics, and plays the Broadcast Director's
recorded clips. On a TV the OBS video is always on screen, beside the track map; the clips take the map's place in turn.

```
OBS (gaming PC) ── RTMPS ──► Cloudflare Stream Live input ── HLS ──► each viewer's browser (hls.js / Safari)
                                     ▲  status (API + lifecycle, cached 10 s on the server)
Render web service ──────────────────┘
  ├─ broadcastSourceRuntime.ts  the stream of the race each TV follows; tells the Broadcast Director it's live
  ├─ Broadcast Director          the map's panel: the track map, or a recorded clip over it
  └─ TV picture (readTvState) carries focus.liveVideo: { stream (playback URL while live), sync, obsVolume, duckLevel }
```

Off by default. Nothing reaches any page, and no Cloudflare request is made, until an Admin turns **Live video on** in the
Admin page's **Live Video & Broadcast Control** and the environment has at least `CLOUDFLARE_STREAM_CUSTOMER_CODE`. The
Site Settings emergency stop (Paid AI, speech and map services) also stops the live video, as delivery is billed.

## Pieces

| Part | Where |
| --- | --- |
| Settings (pure) | `src/lib/liveVideo/broadcastSource.ts` |
| Timeline: buffer, interpolation, delay, commentary timing (pure) | `src/lib/liveVideo/broadcastTimeline.ts` |
| Cloudflare helpers: statuses, URLs, token claims (pure) | `src/lib/liveVideo/streamRules.ts` |
| What the Broadcast Director hears: a session's OBS stream is live | `src/lib/liveVideo/rotationLink.ts` |
| Cloudflare API, status cache, signed tokens (server only) | `src/lib/liveVideo/cloudflareStream.ts` |
| Runtime: each race session's stream and viewers, TV reports | `src/lib/liveVideo/broadcastSourceRuntime.ts` |
| Tables and settings | `src/lib/liveVideoDb.ts` |
| Player | `src/components/LiveOBSPlayer.tsx` |
| TV panel (the OBS video, always on beside the map) | `src/components/TvObsPanel.tsx`, `TvLiveVideoDiagnostics.tsx`, `useBroadcastTimeline.ts` |
| Live Racing view switch and synchronized map | `src/components/LiveRacing.tsx`, `useLiveRacingVideo.ts` |
| Admin | `src/components/LiveVideoControl.tsx` |

### Routes

| Route | Who | What |
| --- | --- | --- |
| `GET /api/live/video` | signed-in users (30/min) | streams of drivers the user may watch on Live Racing, playback URL only while live |
| `POST /api/tv/live-video/report` | paired TVs (20/min) | the TV's player and timeline figures, kept in memory 5 min |
| `GET`/`PUT /api/admin/live-video` | Admins (404 otherwise) | overview; settings |
| `POST /api/admin/live-video/streams` | Admins (10 inputs/hour) | add a stream: `{ email, name, requireSigned, inputId? }`, creates the input through the API when no ID is given |
| `PATCH`/`DELETE /api/admin/live-video/streams/[id]` | Admins | turn on/off, require signed URLs, rename; remove (`?deleteInput=1` also deletes an input the site created) |

### Database

Created on first use by `ensureLiveVideoSchema` (no migration step to run):

- `"LiveVideoStreams"`: `id`, `user_id` (the driver whose racing it shows, `ON DELETE CASCADE`; one stream per driver),
  `name`, `input_id` (the live input's UID, 32 hex), `require_signed`, `enabled`, `created_via` (`api` or `registered`),
  `created_by`, timestamps. At most 10 rows (`MAX_LIVE_STREAMS`). Never a stream key, token or URL with a token.
- `"BroadcastSourceStates"` (each session's camera, from when TVs switched between the map and OBS) is dropped by the same step.
- Settings: `"SiteSettings"` key `live_video` (JSON, `parseLiveVideoSettings`).

Telemetry is never stored for synchronization: the delay buffer lives in each viewer's browser.

## Who sees a stream

The same rule as the Live Racing page's map, so nothing new is invented: a viewer gets a driver's stream when they may watch
that driver (`watchableDrivers`: themselves, Coaches and Admins everyone, everyone Coaches, and those the driver added under
Who Can Watch Me). A TV gets the stream of the driver it follows, else of another driver in the same iRacing subsession the
TV's account may watch. Live Racing is for signed-in users of every level, so there's no membership gate on watching; the
Race Announcers keep theirs (Silver, Gold, Admins).

## What a TV shows

There's no camera to choose. On the right of the TV's screen, under the followed driver:

- **The OBS live video**, always, in its own panel, whenever the session has a stream (`TvObsPanel`). While the stream
  isn't live the panel shows the player's offline card, and plays again by itself when OBS comes back. A session with no
  stream at all has no panel, and the map takes the whole width.
- **The track map** beside it. The Broadcast Director (`docs/broadcast-director.md`) decides what this panel shows: the
  live map, or one of its recorded clips over it (`BroadcastVideoSwitcher`). A clip never covers the OBS video.

While a session's OBS stream is live, the Director is told (`rotationLink.ts`), and its Rotation (the map for
`rotationMapSeconds`, then a clip for `rotationVideoSeconds`) runs outside races too, in practice and qualifying, whenever
nothing important is going on. How often clips come, which categories and Play Video Now are all in the Admin page's
Broadcast Director section; Live Video & Broadcast Control has only the streams, synchronization and audio.

Settings saved while the site still switched the TV between the map and OBS (Automatic, the rotation's OBS and map turns,
the preferred camera for each moment, shot times, transition, fallback) are ignored and dropped at the next save.

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
- The Broadcast Director's clip times are not delayed: they're already absolute times.
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
- OBS sound plays whenever the stream is live, at **OBS volume** × the TV's volume, lowered to **OBS volume while an
  announcer speaks or a recorded clip plays** under their lines and under a clip's own sound. The TV's Settings has *Video sound* on/off; Mute mutes everything.
- Recorded clips' sound follows the Broadcast Director's settings, as before.
- **Don't capture the announcers in OBS.** If OBS captures desktop audio while a RacingCoach page is playing on the same PC,
  viewers hear the announcers twice (once from their own page, once inside the video, seconds later). Capture only the game
  (Application Audio Capture of iRacing/ACC), or keep RacingCoach pages muted on the gaming PC.

## Failures

| What happens | What the viewer sees |
| --- | --- |
| OBS not running / not connected | The offline card in the video panel (TV and Live Racing); the map as usual beside it |
| OBS drops mid-race | The offline card in the video panel; it plays again when OBS returns |
| Player error (network, expired token, decoder) | The player starts again with growing waits (1-15 s), with its error card meanwhile |
| Buffering on one TV | A spinner over that TV's video; its map and the other TVs carry on |
| Cloudflare API down | Status from the lifecycle endpoint, else ERROR: the error card |
| Telemetry stops | Map and leaderboard as before (offline after 15 s); the buffer just stops growing |
| No sync timing | Delay from the calibration, or none; *Sync degraded* |
| AI or speech slow | Commentary already waits for the delay; a line later than its moment is dropped as before |
| Viewer joins late or reconnects | The next picture carries the stream; there is no state to catch up on |
| Server restart | Nothing to restore: the stream is found again with the first picture |

**One instance**: like Live Racing and the Broadcast Director, which sessions are being watched (and whether their OBS
stream is live, for the Director) is in the server's memory. Running more than one web instance would need shared state.

## Costs

Cloudflare Stream (pricing page, 2026-11): ingest and encoding free; **delivery $1 per 1,000 minutes viewed**, every viewer
minute counted (player, HLS); storage $5 per 1,000 minutes a month, prepaid. Inputs the site creates have **recording off**,
so a live broadcast stores nothing. Stream itself is a paid subscription (the smallest storage plan); check the dashboard.

Every viewer pulls the same single transcode from Cloudflare's edge: one OBS upload however many watch. **A TV plays the
stream the whole time it's live**, as it's always on screen, so its minutes are its watch time; the Live Racing page only plays while its view is OBS live or Split; the Admin preview only while picked.

## Tests

- `npm run test:live-video`: the settings (old camera settings ignored), what the Director hears; the buffer
  (duplicates, out of order, bounds, interpolation across the line); the delay and its basis; commentary timing and the
  queue; Cloudflare statuses, URLs and RS256 tokens verified with a generated key; and source guards (Admin-only routes,
  capped bodies, no secrets in browser code, the OBS video always on the TV beside the map and never under a clip, the
  inputs strip without a trace, the emergency stop and watch rule, the CSP).
- Not covered automatically (needs a real stream): the player against Cloudflare, Fire TV playback, real latency figures,
  whether Cloudflare's playlists carry `EXT-X-PROGRAM-DATE-TIME`, signed URLs on a live input. See the checklist below.

### First deploy checklist

- [ ] A Cloudflare live input plays on the Live Racing page (OBS live view), desktop and phone
- [ ] `/tv` shows the OBS video beside the map the whole time, and a recorded clip takes the map's panel only
- [ ] OBS stopped: the video panel shows its offline card, and plays again when OBS is restarted
- [ ] The player's latency line says *measured* or *estimated* (tells you whether `EXT-X-PROGRAM-DATE-TIME` is there)
- [ ] Calibrated sync: a start/finish crossing lines up within a second or two
- [ ] On the Fire TV: playback smooth, and memory holds over a long race with the player kept running
- [ ] If you turn on signed URLs: playback still works (Cloudflare signs tokens for the broadcast's video UID)
