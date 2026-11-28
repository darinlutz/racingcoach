# RacingCoach Ambient Lighting

Telemetry-driven LED lighting for the sim room: the RacingCoach Lighting Agent on the owner's Mac follows the driver's
live session on RacingCoach.app and drives WLED controllers on the home network; a Stream Deck controls it by hand.
The first event is the pit speed limiter: the room's ambient zones turn blue while it's on.

- Install the agent: [MAC_INSTALL.md](MAC_INSTALL.md)
- Hardware, wiring and WLED: [HARDWARE.md](HARDWARE.md)

## Architecture

```
Windows sim PC                    Render (RacingCoach.app)                     Owner's Mac                 Home network
iRacing ─▶ Collector ──POST /api/collector/live──▶ live state (memory)
           (EngineWarnings                         ├─▶ Live Racing page (polls GET /api/live)
            pit limiter bit)                       └─▶ lighting hub ──SSE GET /api/lighting/events──▶ Lighting Agent ──HTTP──▶ WLED (Dig-Quad)
                                                                    ◀──POST heartbeat────────────── │  ▲
                                                                                                     │  └── Stream Deck → racingcoach-lighting → 127.0.0.1:8750
```

- **One telemetry pipeline.** The collector's existing live update (twice a second in the car) carries
  `pitLimiterActive`; when it changes the collector sends one update at once instead of waiting for the next. The
  website keeps no samples: `recordLightingUpdate` (src/lib/lighting/hub.ts) compares each update with the last and
  makes an event only when something lighting cares about changed.
- **The Mac connects out.** The agent holds a Server-Sent Events stream open to the site. No port forwarding, no
  public address, nothing on the internet reaches the Mac or the controllers.
- **Local control never depends on the site.** Scenes, zones, modes and the pit limiter test work over the agent's
  loopback API with the internet down.
- **One server instance.** Like Live Racing's live state, the hub is in the web server's memory; the event stream must
  be served by the instance the collector posts to. Publishing goes through `bus` (hub.ts), so a Postgres
  LISTEN/NOTIFY bus can take its place if the site ever runs on several instances. Check Render's Scaling setting
  is one instance, as Live Racing already needs.

## Pit limiter detection

iRacing's `EngineWarnings` telemetry variable is a bitfield of the dash's warning lights; `irsdk_pitSpeedLimiter` is
`0x10` (irsdk_defines.h, and `EngineWarnings.PitSpeedLimiter` in the SVappsLAB SDK 2.5.0 the collector uses, read from
its assembly). It's set while the limiter is engaged anywhere on track, and is neither `OnPitRoad` (where the car is)
nor `dcPitSpeedLimiterToggle` (the in-car control, which not every car has). `PitLimiter.FromIRacingEngineWarnings`
(collector Core) turns it into `true`/`false`, and `null` while a replay plays or the variable is missing.

ACC's and AC's physics pages have `pitLimiterOn`, already parsed, but no real recording has proved it yet, so they send
`null` (N/A) until one does (docs/multi-simulator.md). Test with a car that has a limiter (GT3s, F4, most prototypes).

The collector shows **PIT LIMITER ACTIVE** (lit blue), **PIT LIMITER OFF** (grey) or **PIT LIMITER N/A** in its Live
Racing tab; the Live Racing page shows the same, and **no data** instead of a stale blue once the telemetry stops
(`pitLimiterView`, 5 s in the car, 12 s in the garage).

## Event contract

src/lib/lighting/events.ts. Events are never stored; each driver keeps the last 200 in memory for agents that resume.

```json
{
  "schemaVersion": 1,
  "eventId": "3f2a91c0-16-42",
  "eventType": "pitLimiter.changed",
  "source": "live",
  "simulator": "iracing",
  "sessionId": "88123456|Race|RACE|spa up",
  "epoch": "3f2a91c0",
  "sequence": 42,
  "timestampUtc": "2026-11-27T18:00:00.000Z",
  "data": { "active": true }
}
```

- `eventType`: `pitLimiter.changed` (`data.active` true, false or null), `session.changed`, `session.ended`.
- `epoch` changes each time the server starts; `sequence` counts up per driver within it. The agent drops an event
  whose sequence it has seen (duplicates, late arrivals) and takes a new snapshot when the epoch changes.
- `source`: `live` from the collector, `test` from the Admin page's Test Lab. Test events have their own state in the
  hub and never touch live race data.

## Endpoints

| Route | Who | What |
|---|---|---|
| `POST /api/lighting/devices/register` | the agent, no sign-in (10/h per IP) | `{ name }` → `{ code, pairingSecret, expiresAt }` |
| `POST /api/lighting/devices/claim` | the agent (240/h per IP) | `{ pairingSecret }` → pending, expired, or `{ deviceId, deviceToken }` once |
| `POST /api/lighting/devices/token` | the agent | `{ deviceToken }` → `{ accessToken, expiresAt }` (15 min), 401 when revoked |
| `GET /api/lighting/events` | access token | SSE: `snapshot`, `lighting`, `heartbeat` (every 2 s), `reauth`; `Last-Event-ID` resumes |
| `GET /api/lighting/state` | access token | the snapshot |
| `POST /api/lighting/devices/heartbeat` | access token | the agent's status for the Admin page; answers the snapshot |
| `POST /api/lighting/devices/revoke` | access token | the agent unpairs itself |
| `GET`/`POST /api/admin/lighting/devices`, `DELETE .../[id]` | Admins | list with status; approve a code; revoke |
| `POST /api/admin/lighting/test` | Admins | Test Lab: `pitLimiterOn`, `pitLimiterOff`, `sessionStart`, `sessionEnd` |

The account is always the device's (who approved it), never a parameter, so a device sees only its own driver.
Only hashes of codes and tokens are stored (`"LightingDevices"`, `"LightingDeviceRegistrations"`, in the privacy
inventory's Sign-in and devices). Lighting Control is for Admins only; `LIGHTING_CONTROL=off` turns every route off.

## The agent

lighting-agent/ (TypeScript, no npm packages, Node 22.18+):

- `lib/stateMachine.ts`: pure. Modes AUTOMATIC (live and test events), MANUAL (baseline only), TEST (test events only),
  DISABLED (leaves the lights alone). Precedence: disabled / all off; manual mode; rules by priority (red flag 30,
  yellow 20, pit limiter 10, configurable); the baseline (scene plus manual changes). Protected zones (pedals, the
  engineer's light) change only when named. Every look is capped per zone and scaled by the master brightness.
- `lib/runtime.ts`: the inputs, freshness (5 s), desired versus acknowledged looks, sending only differences, a full
  resend every minute and when a controller comes back, 250 ms minimum between changes of a zone, latency.
- `lib/wled.ts`: WLED JSON API; touches only the named segments, never the controller's brightness; one request at a
  time per controller with later commands merged; 1.5 s timeout, 3 attempts, offline after a failure.
- `lib/site.ts`: pairing, access tokens, the SSE stream with exponential backoff and jitter (1 s to 30 s), an 8 s
  watchdog, heartbeats every 5 s.
- `lib/localApi.ts`: 127.0.0.1:8750 only, token in a 0600 file, Host and Origin checked.
- Config: `~/Library/Application Support/RacingCoachLighting/config.json` (controllers, zones, scenes, rules,
  settings; validated, home network addresses only), `state.json` (mode, scene, manual changes). Logs:
  `~/Library/Logs/RacingCoachLighting/agent.log`, JSON lines, 2 MB × 5, tokens redacted.

## Testing

- `npm run test:lighting`: the contract, the hub (sequencing, resume, isolation, test events), the indicator rule.
- `npm run test:lighting-agent`: the state machine, the SSE parser, WLED against a stand-in controller (body,
  serializing, retries, offline), the runtime end to end with mock controllers (white → blue → white, red by hand →
  blue → red, duplicates, out of order, stale, session end, controller failure), the local API's guards.
- `npm run test:collector-core`: the pit limiter bit.
- `racingcoach-lighting run --mock`: the agent with mock controllers, before the hardware is wired.

### Measured (2026-11-27, development server on the same PC, mock controller)

| | Result |
|---|---|
| Collector POST to controller acknowledged, pit limiter on (5 runs) | 67, 74, 84, 112, 306 ms |
| The agent's own part (event received to acknowledged) | 22–32 ms |
| Server receipt to acknowledged | 23–34 ms |
| Collector went quiet → baseline back | 5.9 s (timeout 5 s) |
| Collector closed → baseline back | 332 ms |

The slower on/off cases (about 300 ms) are the 250 ms minimum between changes of one zone. Production adds the
collector's and the Mac's internet round trips and the real controller (WLED typically answers in 10–50 ms on a
wired network); measure again with the hardware.

## Configuration (Phase 10)

The installation's configuration is in Postgres, the owner's (src/lib/lighting/lightingConfig.ts, tables in
lightingSchema.ts, all `ON DELETE CASCADE` from `"Users"`):

| Table | Holds |
|---|---|
| `LightingInstallations` | one per owner: `version` (raised on every save), settings, start scene |
| `LightingControllers` | key, name, home network address, port |
| `LightingZones` | key, name, controller, WLED segment, enabled, max brightness, racing events, protected, order |
| `LightingScenes`, `LightingSceneZones` | each scene's look for every unprotected zone, and per zone |
| `LightingEventRules` | event, priority, zones (`zone_keys` NULL: every zone taking part in racing events), look, duration |

- **One format, one check.** Read and written whole in `LightingConfig`'s shape (src/lib/lighting/model.ts, shared
  with the agent); `parseLightingConfig` rebuilds a config from JSON (known fields only, sizes capped) and
  `configProblems` checks it (home network addresses only, segments not shared, scenes and zones that exist).
- **Saves** (`PUT /api/admin/lighting/config` `{ expectedVersion, config }`, the Configuration tab,
  LightingConfigEditor.tsx) replace the configuration in one transaction, locked on the installation row; a save made
  from an older version is refused with 409 `{ currentVersion }`.
- **The agent** gets the version in every heartbeat's answer and fetches `GET /api/lighting/config` when it differs,
  keeping it as `config.json` (the cache it starts from with the site out of reach). A config made on the Mac has
  version 0; when the site has none, the agent uploads it once (`POST /api/lighting/config/import`, refused once there
  is one), so an address set there before isn't lost.
- **Private details.** Controller addresses go only to the owner's Admin page and the owner's own paired agents. In
  the privacy inventory as Sim room lighting (exported as lighting/configuration.json, gone with the account).
- **Tests**: `npm run test:lighting` (the parser), `npm run test:lighting-db` (round trip, conflicts, isolation,
  cascade, pairing; with `LIGHTING_TEST_DATABASE_URL`). Measured on the dev server: the agent's upload within about
  6 s of connecting, a save on the site in the agent's cache in about 5 s (the heartbeat interval).

## Stream Deck (Phase 11)

The 32-key profile, its button apps (`racingcoach-lighting streamdeck install`), the steps in the Stream Deck app, and
the native plugin's evaluation are in `STREAM_DECK.md`. The layout is `src/lib/lighting/streamDeckLayout.ts`, shared by
the agent and the Admin page's Stream Deck tab. Phase 11 added these commands:

- `color` (every unprotected zone).
- Toggling tests, and flag tests (`POST /test/event`; a flag shows only through an enabled rule).
- `--notify` (macOS notifications; failures from a key always notify).

## Not done yet

- Controller discovery and connection tests run from the Mac's CLI (`controller-test`), not the Admin page.
- Flags, low fuel, personal bests and position changes: rules are ready, but their sources aren't verified or sent.
- A native Stream Deck plugin: evaluated in STREAM_DECK.md, to build after the hardware proof of concept.
