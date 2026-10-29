# TV Broadcast Mode

Live Racing on a TV, for the Amazon Silk browser on Fire TV (built for a TCL Fire TV), with the Race Announcers'
commentary. The TV opens `/tv`, pairs with a code, and then shows the race its account may watch, live, worked with the
remote.

## How it fits the existing system

Nothing in the collector, the live position store or the commentary was replaced. TV Broadcast Mode reads the same
in-memory Live Racing state the Live Racing page reads, and uses the same Race Announcer agent and voices.

```
iRacing ─► Collector ─POST /api/collector/live─► liveRacing.ts (memory: positions, field, race events)
                                                     │
              ┌──────────────────────────────────────┤ readLiveDrivers / readRaceEvents
              ▼                                      ▼
   Live Racing page (GET /api/live, 1 s)    tvBroadcast.ts readTvState ─► GET /api/tv/stream (SSE)
                                                                      └► GET /api/tv/state (polling fallback)
   POST /api/live/announcer (WAV) ─┐
   POST /api/tv/announcer   (MP3) ─┴─► announcerCommentary.ts commentate ─► raceAnnouncer.ts (AI)
                                                                         └► coachVoice.ts synthesizeSpeech
                                                                             (ElevenLabs / Chirp / OpenAI)
```

## Files

| File | What it does |
| --- | --- |
| `src/app/tv/page.tsx` | The TV page. Covers the site's nav and footer; pairing screen or broadcast |
| `src/app/tv/link/page.tsx`, `src/components/TvLink.tsx` | The TV Link page: type the TV's code, list and unpair TVs (signed-in users) |
| `src/components/TvApp.tsx` | The 1920×1080 stage scaled to the window, with the screen edges (overscan) margin |
| `src/components/TvPairing.tsx` | The pairing code, its countdown, a new code when it expires |
| `src/components/TvBroadcast.tsx` | The broadcast: header; on the left the leaderboard (15 rows) with the announcer lower third and race events under it; on the right the followed driver, the map and the inputs strip; controls; Settings |
| `src/components/TvLeaderboard.tsx` | The leaderboard: Live Racing's look (country flags, car maker logos, watched drivers' dots, fastest-lap stopwatch, You) at TV size, memoized rows |
| `src/components/TvMap.tsx` | The track map: Live Racing's `LiveTrackMap` at 20 redraws a second, no imagery sharpening, satellite on/off in Settings |
| `src/components/TvInputs.tsx` | The followed driver's inputs (delta, pedals, wheel, gear, speed, trace) at TV size, 20 redraws a second |
| `src/components/TvEventFeed.tsx` | The race events |
| `src/lib/liveMapTrack.ts` | A map's track (outline, length, focus areas), shared by `/api/live/outline` and `/api/tv/outline` |
| `src/components/useTvFeed.ts` | SSE with watchdog and reconnects; falls back to polling |
| `src/components/useTvCommentary.ts` | Asks for commentary, queues and plays it, hands off with the In-Car AI Coach |
| `src/components/useTvRemote.ts`, `src/lib/tvRemote.ts` | D-pad navigation, Back, Play/Pause |
| `src/lib/tvAudio.ts` | The commentary queue (order, staleness, no repeats) and the test/unlock tone |
| `src/lib/tvAuth.ts`, `src/lib/tvPairingCode.ts` | Pairing codes and TV sessions |
| `src/lib/tvBroadcast.ts` | Builds the TV's picture of the race on the server |
| `src/lib/announcerCommentary.ts` | One commentary, shared by `/api/live/announcer` and `/api/tv/announcer` |
| `src/lib/coachVoice.ts` | `synthesizeSpeech` takes a `format`, `'wav'` (default, unchanged) or `'mp3'` |
| `scripts/tv-broadcast.test.mjs` | `npm run test:tv` |

## Endpoints

| Route | Auth | What |
| --- | --- | --- |
| `POST /api/tv/pair` | none (20 per IP per 10 min) | New pairing code `{ code, expiresAt }`; sets the `tv_pairing` cookie |
| `GET /api/tv/pair` | `tv_pairing` cookie | `{ status: pending \| paired \| expired \| none }`; `paired` sets `tv_session` |
| `POST /api/tv/link` | site session | `{ code }` pairs the TV with the signed-in account (10 tries per account, 30 per IP, per 10 min) |
| `GET /api/tv/devices`, `DELETE /api/tv/devices/[id]` | site session | List and unpair the account's TVs |
| `GET /api/tv/session`, `DELETE /api/tv/session` | `tv_session` | Whether the TV is paired; the TV unpairs itself |
| `GET /api/tv/stream?driver=` | `tv_session` | Server-Sent Events: the race on change (checked each second), `ping` every 15 s, `unpaired` when revoked; ends after 10 min and the browser reconnects |
| `GET /api/tv/state?driver=` | `tv_session` | The same picture once (polling fallback) |
| `GET /api/tv/outline?key=&driver=` | `tv_session` | The map's track, as `/api/live/outline` gives the Live Racing page |
| `GET /api/map-tiles`, `/api/map-tiles/[z]/[x]/[y]` | site session or `tv_session` | Satellite imagery settings and tiles (existing routes, now also open to paired TVs) |
| `POST /api/tv/announcer` | `tv_session` | `{ driverId, after, lead, color }` → `{ seq, lines: [{ speaker, text, audio }] }`, audio base64 MP3. Rate limited as `raceAnnouncer`, against the paired account |
| `POST /api/tv/announcing` | `tv_session` | Holds the account's own In-Car AI Coach while a line plays |

## Database

Created by `ensureUserSchema` (`src/lib/users.ts`) on first use; no migration step:

- `racingcoach."TvPairings"`: `code_hash`, `device_hash` (the TV's `tv_pairing` secret), `label`, `user_id` (set when
  the code is entered), `expires_at` (10 minutes), `approved_at`. Deleted when claimed; expired ones are purged when
  new codes are made.
- `racingcoach."TvSessions"`: `token_hash`, `user_id` (`ON DELETE CASCADE`, so Delete Account removes them), `label`
  (e.g. "Fire TV (Silk)", from the user agent; the user agent itself isn't stored), `created_at`, `expires_at`
  (30 days), `last_seen_at` (written at most once a minute), `revoked_at`. At most 10 active per account.

## Security

- The TV never shows or receives a password, the account's own `session` cookie or any long-lived token in the page.
  Its `tv_session` cookie is HttpOnly, and only hashes are stored server side.
- Scope: `getTvSession()` is read only by `/api/tv/*` and the `/tv` page; `getCurrentUser()` never reads
  `tv_session`. A TV can watch the drivers its account may watch (the same `watchableDrivers` rule) and ask for
  commentary, nothing else.
- Pairing codes: 8 characters from a 26-character alphabet (about 2×10¹¹ combinations), valid 10 minutes, single
  use, only claimable by the TV holding the matching `tv_pairing` secret, with attempt limits on entry.
- Revocation: the TV Link page's Unpair ends the session at once; an open stream notices within 15 s and the TV goes
  back to its pairing screen. Expiry: 30 days.
- ElevenLabs, OpenAI and Google keys stay on the server; the TV receives finished MP3 audio only.

## Map, inputs and leaderboard on a low-powered TV

- The map and the inputs are the Live Racing page's, but redrawn at most 20 times a second instead of every frame,
  and the satellite imagery isn't sharpened (an SVG filter that is costly to redraw). The satellite imagery can be
  turned off in Settings if the TV struggles.
- Each picture of the race carries the map's dots with how old their positions are; the TV moves them on between
  pictures at each car's pace, as the Live Racing map does.
- Each picture carries only the last 3 seconds of the followed driver's inputs (rounded); the TV keeps 12 seconds
  itself and plays them back 1.6 s behind live, like the Live Racing page.
- A picture is about 10-20 KB with a full field, once a second.

## Commentary behaviour

- Start Broadcast (a button press, as browsers only allow sound after one) plays a silent clip on the one audio element
  used for everything after, and requests a screen Wake Lock where supported.
- When the followed driver's `eventSeq` moves on, the TV asks for commentary on the new events (one request at a
  time). Events from before it started following that driver or session, and events while commentary was off, muted
  by the TV going to the background, or paused after an error, are skipped, never commentated late; the server
  ignores events older than 30 s anyway.
- Lines play one at a time in order; a line waiting more than 20 s is dropped; the same words aren't played twice.
- The server remembers the newest event each TV session was given commentary for, so a reconnect or reload doesn't
  repeat it.
- When the TV follows its own account's driving, each line waits for the In-Car AI Coach and holds it while playing,
  as the Live Racing page does.
- The TV going to the background (Home button, another app) stops playback and clears the queue.
- Mute silences the audio but the lines still appear (and still use the account's AI and speech quota). Turning
  Commentary off stops the requests altogether.

## Deploying on Render

Nothing new to configure; deploy as usual (push to the branch Render deploys).

- **Environment variables**: none new. It uses the existing `DATABASE_URL`, `SITE_URL` (the address the TV tells
  you to visit is `<SITE_URL host>/tv/link`, so it must be set in production), the ElevenLabs announcer voices
  (`ELEVENLABS_<LANGUAGE>_ANNOUNCER_LEAD_VOICE_ID` / `_ANNOUNCER_COLOR_VOICE_ID`), and `GOOGLE_TTS_API_KEY` or
  `OPENAI_API_KEY` as the fallback voice. The Admin page's Enable AI Features must be on for commentary.
- **One instance**: like Live Racing, live positions, the TV commentary dedupe and the pairing attempt limits live in
  the server's memory. Keep the web service at one instance (no autoscaling) or move them to shared storage first.
- **Server-Sent Events**: Render's proxy passes streaming responses through. The route sends
  `Cache-Control: no-cache, no-transform` (which also stops Next's gzip from holding events back) and
  `X-Accel-Buffering: no`. Each stream ends after 10 minutes and the TV reconnects; a deploy cuts open streams and the
  TVs reconnect by themselves. If the TV's status pill says *slow connection mode*, the stream isn't reaching it and
  it's polling `/api/tv/state` every second instead, which still works.
- **HTTPS**: needed for the `Secure` cookies and the Wake Lock API; Render's domains have it.
- **Tables**: created on the first request after deploy.
- **Cost**: each commentary is one AI call plus one or two speech calls, the same as on the Live Racing page, counted
  against the paired account's AI limits (feature `raceAnnouncer`).

## Testing

Automated (run): `npm run test:tv` (pairing codes, D-pad navigation, commentary queue, test tone),
`npm run test:cookie-consent` (the new cookies and storage are in the inventory), `npm run lint`, `npm run build`.

Not yet tested: the pairing flow, the stream and commentary against a running server and database, and anything on
Fire TV hardware. Use the checklist below.

### TCL Fire TV checklist

Setup: deploy, sign in to RacingCoach.app on a phone, and have the RacingCoach.app Collector running with iRacing (a
practice or race session; an online race tests the leaderboard and race events best).

**Pairing and authentication**
- [ ] In Silk on the Fire TV, open `https://<your domain>/tv`. A code and a countdown appear; the address shown is
      your real domain.
- [ ] On the phone, open Live Racing → *Watch on a TV* (or `/tv/link`), type the code in lower case with a dash.
      Within ~3 s the TV switches to the broadcast. The phone lists the TV as "Fire TV (Silk)".
- [ ] Type a wrong code: "doesn't match" message. Ten wrong codes in a row: "Too many tries".
- [ ] Leave the pairing screen 10+ minutes: the code is replaced by a new one by itself.
- [ ] Use a code once, then try it again from another browser: refused.
- [ ] On the phone, Unpair the TV. Within ~15 s the TV returns to the pairing screen.
- [ ] Pair again, then Settings → *Unpair this TV* on the TV: it returns to pairing, and the phone's list no longer
      shows it (reload the list).
- [ ] Nowhere on the TV is a password, email address or token shown.

**Remote navigation**
- [ ] With nothing pressed, *Start Broadcast* has a yellow focus ring.
- [ ] Left/Right move along the control bar in order; Up/Down do nothing harmful.
- [ ] Select presses the focused control.
- [ ] Settings opens a panel with the first button focused; the D-pad stays inside the panel; Back closes it and the
      focus returns to the Settings button. A second Back leaves the page (expected).
- [ ] Play/Pause toggles mute (or starts the broadcast before it's started).

**Audio**
- [ ] Before Start Broadcast, no sound plays even when events happen.
- [ ] Press Start Broadcast: the button becomes *Test sound*; Test sound plays a short beep.
- [ ] Drive a lap (or pit, or gain a position): a Lead Announcer line plays, the lower third shows "Lead Announcer"
      in red with the text; a Color Announcer line follows (blue), never at the same time.
- [ ] Volume −/+ changes loudness in 10% steps; Mute silences it and shows *Muted* on the lower third; Unmute
      restores it.
- [ ] Commentary: Off stops new lines; turning Lead or Color off leaves only the other announcer.
- [ ] Press Home during a line: the sound stops. Return to Silk: nothing from while you were away is played late.
- [ ] Reload the page (or turn the TV's Wi-Fi off and on): after Start Broadcast, no earlier line is repeated.
- [ ] While watching your own driving with the In-Car AI Coach on: the announcers never talk over the coach.
- [ ] Turn off Enable AI Features on the Admin page: the TV says race commentary is turned off; controls for it are
      hidden after a reload.

**Live data and reconnection**
- [ ] The header shows the track, session, flag, lap (of total) and time left that match iRacing.
- [ ] The leaderboard matches iRacing's positions, gaps and intervals; your row is red; the fastest lap is purple;
      cars in the pits/off track show PIT/OFF.
- [ ] Values the collector doesn't send show "—", never a made-up number.
- [ ] Unplug the TV's network for ~30 s: the pill shows *Reconnecting…*, then *LIVE* again once it's back, with
      current data.
- [ ] Redeploy on Render during a session: the TV reconnects by itself.
- [ ] Change session in iRacing (practice → qualifying → race): the header and leaderboard follow; commentary starts
      afresh, with nothing from the previous session.
- [ ] Close iRacing: after ~15 s the TV says the driver is offline; restart it and the TV picks them up again.
- [ ] With two RacingCoach.app drivers you can watch live, *Next driver* switches who the TV follows.

**Map, inputs and leaderboard**
- [ ] The map shows the track (over satellite imagery where it's set up), your car as a large dot in your color and
      the other cars as small numbered dots in their class colors, moving smoothly round the lap, in step with iRacing.
- [ ] On a track with no saved map yet, the map is a dashed approximate outline (or a placeholder oval) with a note.
- [ ] Settings → Satellite map → Off hides the imagery; the choice survives a reload.
- [ ] The Driver Inputs panel shows the delta to best, throttle and brake bars, wheel, gear and speed (in your
      Preferred Units), about 2 s behind live, moving smoothly; the trace scrolls.
- [ ] *Next driver* moves the map highlight, the inputs and the leaderboard highlight to the new driver.
- [ ] The leaderboard shows 15 rows; further back than P15, it shows the first 7 and the cars around you.
- [ ] The leaderboard shows each driver's country flag and car maker logo, the purple stopwatch on the fastest lap,
      watched drivers' colored dots, and "You" on your row.
- [ ] **Performance**: watch for 10 minutes in a full race. The dots and inputs should move without stutter and the
      remote should respond at once. If it lags, turn the satellite map off and note whether that fixes it.

**Layout and readability**
- [ ] The whole picture fits the screen with nothing cut off. If the edges are cropped, Settings → Screen edges →
      *TV safe area*; if there's a wide black border, *Full screen* edges. The choice survives a reload.
- [ ] From the couch (about 3 m / 10 ft), the leaderboard names, gaps and the announcer line are readable.
- [ ] The full screen button (if shown) hides Silk's address bar; pressing it again, or Back, leaves full screen.
- [ ] Leave it running for 30+ minutes during a race: no screensaver while broadcasting (if the Fire TV's screensaver
      still appears, Wake Lock isn't supported there; set the screensaver to Never), no slowdown, the remote still
      responds promptly.
