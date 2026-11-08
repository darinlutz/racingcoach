# Multi-simulator telemetry

How the collector and website are set up to support simulators other than iRacing, what's done, what isn't, and how to add one. iRacing and ACC are supported for laps (recording, upload and the website's analysis); ACC was checked against two real Spa recordings, see [What's been proven](#whats-been-proven). The live features are still iRacing's only.

## Current state

| Area | State |
| --- | --- |
| iRacing | Same as before. Lap files are byte-identical on the regression fixtures; uploads only gain fields the site ignores or defaults |
| Adapter contracts, canonical frames, lap tracking, detection | Built and tested with synthetic telemetry |
| Other simulators' laps through the shared pipeline | Built and tested with a scripted test adapter, and with a real ACC recording at Spa (2026-11-05): ACC's adapter, behind `--simulator acc`, has 23 channels checked in two Spa recordings and marked collected, the rest still documented |
| Website | Stores which simulator a lap is from, and maps other simulators' tracks and cars to the site's on the Coach page's Simulator Mapping (a mapped lap takes the site's track key and names, so it compares with iRacing's). **Refuses laps from any simulator but iRacing** until its status in `simulators/capabilities.json` is `supported` |
| In-Car AI Coach, overlays, brake beeps, Rotation Model, Live Racing, Driver Radio, race results | **Still read iRacing's `TelemetryData`.** Another simulator gets lap recording and upload only until these are moved to frames, one at a time, and checked |
| Lap Compare's "Not Available" display | Done from the data: a channel with no values in a lap's file (ChannelGate leaves every unconfirmed one empty) shows as not available in that lap, and the coaching inputs leave it out. `channelAvailable` in `src/lib/simulators.ts` is still there for a page that needs the matrix's own answer |

## Architecture

```text
 iRacing                       Another simulator (none yet)
    |                                   |
 IRacingAdapter                 its ISimulatorAdapter
    |            \                      |  TelemetryFrame, on its reading thread
    |             \                     |
    | TelemetryData \  ToFrame       FramePump (bounded, drops oldest)
    | (RunNativeAsync) \ (tests)        |
    |                   \            FrameLapTracker (laps from frames)
 CollectorEngine.Handlers \             |
  |- LapRecorder ------------+   CanonicalLapPipeline
  |- coach, overlay, beeps,  |          |
  |  Rotation, Live Racing,  |          |
  |  Driver Radio, races     |          |
  |                          v          v
  |                     CompletedLap (LapSamples)
  |                             |
  |                         LapWriter  -> lap CSV + session.json
  |                             |
  |                         LapUploader -> POST /api/collector/laps
  |                                              |
  |                                  collectorLapSchema, lapRefusal
  |                                              |
  |                                   saveCollectorLap -> "CollectorLaps"
  v                                              |
 (iRacing only, as before)          Debrief Coach, Lap Compare, My Dashboard
```

iRacing deliberately keeps its own path. Its consumers read the SDK's generated `TelemetryData`, and rewriting them all to frames at once would be a large change to working code with no simulator to justify it yet. `ToFrame` and `FrameLapTracker` are held to it by tests, so the shared path is proven equivalent before anything has to depend on it.

| Project / file | What it is |
| --- | --- |
| `collector/RacingCoach.Collector.Core/` | No simulator SDK, no WPF: `TelemetryFrame`, `ISimulatorAdapter`, `SimulatorCatalog`, `FrameLapTracker`, `LapCsvFormat`, `SimulatorSelection`/`SimulatorSupervisor`, `FramePump` |
| `collector/RacingCoach.Collector/IRacingAdapter.cs` | The SDK connection (moved from `CollectorEngine`), `Probe`, and `ToFrame`/`ToSession` |
| `collector/RacingCoach.Collector/LapSamples.cs` | What `LapWriter` needs from a lap: `IRacingLapSamples` (the CSV columns, moved from `LapWriter`) and `CanonicalLapSamples` |
| `collector/RacingCoach.Collector/CanonicalLapPipeline.cs` | Adapter to `LapWriter`, for other simulators |
| `simulators/capabilities.json` | The capability matrix, built into the collector and read by the website |
| `src/lib/simulators.ts`, `simulatorMappings.ts`, `simulatorSchema.ts` | The website's side |

**Selecting a simulator**: without `--simulator` the collector runs iRacing exactly as before and no detection runs. `--simulator auto` selects by `SimulatorSelection`: the first adapter in registry order producing telemetry, else the first with its process running and interface open; never a process alone. `--simulator <id>` is the manual override; an id with no adapter is logged as an error, and never falls back to iRacing. One adapter runs at a time, and a frame or session naming another simulator is refused. It polls every 2 s while nothing is running.

## iRacing's coupling

What would have to change for a feature to work with another simulator.

| Where | Tied to iRacing by |
| --- | --- |
| `Program.cs` | `[RequiredTelemetryVars]`: the SDK generates `TelemetryData` from this list, at 60 Hz |
| `LapRecorder.cs` | `TelemetryData`, 60 Hz thresholds (0.02 per sample, 30 ticks), `TrackLocation` |
| `InCarCoach.cs`, `BrakeBeeps.cs`, `DriverRadio.cs`, `RotationMonitor.cs`, `OverlayEngine.cs`, `LiveRacing.cs`, `RotationWindow`, `TargetTelemetryWindow`, `MainWindow` | `TelemetryData`. `LiveRacing` also the `CarIdx*` arrays and session info's driver list; `DriverRadio` iRacing's radio variables |
| `RaceResults.cs` | Session info's `ResultsPositions`, subsession ids |
| `IbtFile.cs`, `IbtEnricher.cs`, the `.ibt` logic in `CollectorEngine` | iRacing's file format: the only source of Lat/Lon/Alt |
| `TrackKeys` | `WeekendInfo.TrackName`. iRacing's only: other simulators' keys travel with the session |
| `scripts/TelemetryEngine.js` | SimHub's iRacing property names, `OverlayEngine.Prop` |
| `rotation-model/calibrations.json` | Calibrated per iRacing `CarPath`, on iRacing's sign conventions |
| Lap CSV format | iRacing's variable names, units and signs. **This is the de facto canonical format**, so other simulators convert to it |
| `"CollectorLaps"` | `iracing_session_id`, `iracing_subsession_id` (0 for other simulators, which take the offline paths); `track_key` |
| `"Tracks"` | `track_key`, `track_length_feet`, `track_latitude`/`longitude`, bounds and outlines: all iRacing's. Focus areas are fractions of an iRacing lap |
| `findTrackByKey`, `dashboard.ts`, `liveRacing.ts`, `tvBroadcast.ts`, `broadcastTracker.ts`, `raceFlags.ts`, `liveWeather.ts`, `raceHistory.ts` | iRacing's track keys, session flags, `CarIdx*` semantics, iRating and safety rating |
| `lapChannels.ts` | Estimates slip and balance from iRacing's signs and a typical GT3's geometry; its rear wheel slip assumes no wheel speeds |

### The telemetry pipeline, as documented from the code

- **Connection**: `TelemetryClient<TelemetryData>.Create` then `Monitor`, which waits for iRacing and reconnects by itself. Handlers: connect state, session info, telemetry, error. Live delivery can drop samples when a handler lags; playback is synchronous.
- **Sampling**: 60 Hz. All CSV columns are per sample. Lat/Lon/Alt, surface temperatures, continuous carcass temperatures, pressures and ride heights only come from the `.ibt` after the stint.
- **Laps**: a lap runs from one forward line crossing to the next, its time interpolated between samples. Thrown away on leaving the car, replay, session change, time going backwards, a gap over 30 ticks, a jump over 0.02 of a lap or a backward crossing; under 10 s doesn't count.
- **Race results**: `RaceResultTracker`, from session info, final results replacing provisional ones. Not changed.
- **Upload**: multipart `lap` (JSON, `collectorLapSchema`) and `csv` (gzip). `clientLapId` makes retries idempotent: a duplicate returns 200, and a copy with positions replaces one without.
- **Storage**: `"CollectorLaps"`, one row per lap with the gzip CSV. Retention and viewer rules as in AGENTS.md: unchanged, and other simulators' laps fall under them too.
- **Coaching**: server side, from the CSVs (`measureDebriefSession`) and the plan's rules on live telemetry in `InCarCoach.cs`.

### Conventions a new adapter must convert to

| Channel | Canonical (iRacing's) | Why it matters |
| --- | --- | --- |
| Speed | m/s | Brakepoint distances, charts |
| Pedals | 0-1 | `BRAKE_THRESHOLD`, `THROTTLE_THRESHOLD` |
| Clutch | 1 = engaged, as understood of iRacing's `Clutch`; confirm in a recorded lap | The opposite of a pedal position |
| Steering | Radians at the wheel, + left | Charts plot right up; `lapChannels.ts` assumes a steering ratio |
| Yaw rate | rad/s, + left | Rotation Model, car balance |
| Velocity | Car frame, forward and left | Rotation Model's sideslip |
| Accelerations | m/s², car frame, vertical includes gravity | Rotation Model. ACC documents `accG` as global: check |
| Gear | -1 reverse, 0 neutral, 1 first | Other simulators commonly number differently: check |
| Tire temperatures | Left, middle, right seen from behind, °C | Which is the outer edge depends on the car's side (`tireTempColumns`) |
| Pressures | kPa | |
| Ride height | m, per corner | |

Each must be confirmed against the real simulator, by driving known maneuvers: a left turn, braking, reverse. A name matching isn't evidence.

## Canonical telemetry

`TelemetryFrame` (`TelemetryFrame.cs`, documented field by field). Rules: **null means unavailable, never 0**; canonical units are iRacing's; only the simulator's own values go in, so anything calculated is the consumer's and is called estimated there (`TrackedLap.LapTimeEstimated`, the website's slip estimates); native ids are kept (`SimulatorSession.NativeTrackId`, `NativeCarId`); ordering comes from the adapter's reading thread and is kept by `FramePump`; no samples are ever interpolated. Lap time is the one interpolation, of the line crossing between two samples, as iRacing's has always been. `LapCsvFormat` writes frames as iRacing's CSV, leaving what's missing as empty cells.

The frame holds what the lap CSV holds. The other channels the request listed (pitch, roll, wheel speed, slip, wear, load, travel, damper, oil pressure, boost, sectors, flags) are tracked in the matrix but have no frame fields yet, because nothing consumes them: add a field when an adapter and a consumer need it, as a nullable, without changing the CSV's existing columns.

**Missing values on the website** (closed 2026-11-06): steering, positions and every optional column read as NaN where a cell is empty, never 0. Brake, Throttle and Speed, which every analysis needs at every sample, have a missing cell filled from its neighbours (`fillGaps` in `lapData.ts`), and `checkLapCsv` refuses an upload with any of them entirely empty.

## Capability matrix

`simulators/capabilities.json` is authoritative, with a note and source per entry. Researched 2026-11-01. Support: **collected** by the adapter, **after stint** from a file, **documented** by the publisher but unconfirmed, **no** per the publisher's documentation, **?** unchecked.

| Channel | iRacing | ACC | Note on ACC |
| --- | --- | --- | --- |
| Speed, pedals, clutch, RPM, gear | collected | collected | km/h; gears 0 reverse, 1 neutral, 2 first; clutch is engagement despite the document calling it a pedal |
| Steering angle | collected | **no** | `steerAngle` is -1 to 1 input, not an angle; full lock read ±0.752, a share of the driver's wheel range, so no angle can be made from it |
| Steering input | **no** | collected | + right in ACC, negated to + left. No CSV column carries it yet |
| Lap fraction | collected | collected | |
| Lap distance, track length | collected | **no** | `trackSplineLength` not used. Brakepoints in feet need another source |
| Accelerations | collected | collected | The car's own g despite "global coordinates"; vertical without gravity, so 1 g is added |
| Yaw rate, local velocity | collected | collected | y up, x left, z forward |
| Yaw | collected | collected | `heading` turns the other way to iRacing's Yaw (negated); 0 is ACC's world +z, and the website finds Yaw's zero from each lap's positions anyway |
| Pitch, roll | documented | documented | |
| GPS position | after stint | **no** | World coordinates only; the website places them on the earth (next row) |
| World position | **no** | collected | `carCoordinates` by `playerCarID`, meters, every sample (Spa: 6938 m round the lap, y up, 102 m of climb), written as `WorldX`/`WorldY`/`WorldZ` after `FuelKgPerLtr` from adapter 4. x and z are mirrored against east and north. The website fits them once per track to the mapped iRacing track's outline and reads them as Lat/Lon/Alt (`src/lib/worldAlignment.ts`, `src/lib/worldPositions.ts`) |
| Tire pressure | after stint | collected | psi |
| Tire surface temperature | after stint | **no** | `tyreTempI/M/O` not shown |
| Tire carcass (three across) | after stint | **no** | ACC has one core value instead: a different channel |
| Wheel speed | **no** | documented | rad/s |
| Slip ratio, slip angle | **no** (estimated on the site) | documented | Slip ratio "in radians": confirm what it holds |
| Tire wear, load | documented, **no** | **no** | Marked not used |
| Ride height | after stint | **no** | `rideHeight[2]` marked not used |
| Water temperature | collected | collected | |
| Oil temperature, pressure | collected, documented | **no** | Not in the document |
| Fuel level | collected | collected | Liters, though the document says kg: it matches `fuelXLap` and the Huracán's 120 L tank. ACC burned none in either Spa session |
| ABS active | collected | collected | `abs`, only 0 or 1 |
| Air and track temperature | collected | collected | °C. Wind read 0 throughout, so it's left out |
| Lap time, pit lane | collected | collected | |
| Sector times | **no** | documented | |
| Lap validity | ? | collected | `isValidLap`, latched from the line: ACC resets it there, sometimes a read before it counts the lap |
| Incidents | collected | **no** | `numberOfTyresOut` also not used, so no off-track flag from it |
| Other cars | collected | documented | Positions and ids only |

ACC's field status comes from the colors in Kunos's PDF, which plain text extraction loses: red fields include `rideHeight`, `wheelLoad`, `tyreWear`, `camberRAD`, `numberOfTyresOut` and `tyreTempI/M/O`.

### Interfaces

| Simulator | Priority | Interface | Setup | Licensing | Status |
| --- | --- | --- | --- | --- | --- |
| iRacing | P0 | Shared memory, `.ibt` | None | Third-party SDK library | Supported |
| ACC | P1 | `Local\acpmf_physics`, `_graphics`, `_static` | None | Kunos documents it for tools; Kunos confirmed use by RacingCoach.app (2026-11-06) | Supported (laps, adapter 2 on) |
| Assetto Corsa | P1 | The same names as ACC, different layout | None | Not confirmed | Interface identified |
| Automobilista 2 | P2 | Project CARS 2 shared memory, UDP | Must be turned on in settings | Not confirmed; no Reiza document found | Interface identified |
| Le Mans Ultimate | P2 | Built-in shared memory `LMU_Data` | Enable Plugins on | Not confirmed; only community sources. TinyPedal is GPL-3.0: don't copy it | Interface identified |
| rFactor 2 | P2 | Third-party plugin | Install plugin | Plugin may be bundled only if the distribution is free: **don't bundle it with paid plans** without permission | Interface identified |
| RaceRoom | P3 | Developer's shared memory API | None | Unlicense | Interface identified |
| AC EVO | P3 | `Local\acevo_pmf_*` | None | Not confirmed. Early access; names changed in 0.6 | Interface identified |
| EA F1 | Future | UDP, specification per game | Setting | Not confirmed | Interface identified |

AC, ACC and AC Rally share one memory name, so an adapter must check the process and the static page's version too. Confirm each licence, with legal advice for the paid product, before release.

## Database

Additive only (`src/lib/simulatorSchema.ts`, run by `ensureUserSchema`, in the same transaction as the rest):

- `"CollectorLaps"`: `simulator TEXT NOT NULL DEFAULT 'iracing'`, `native_track_key`, `payload_version INTEGER NOT NULL DEFAULT 1`, `adapter_version`. Adding a column with a constant default doesn't rewrite the table. Every existing row reads as iRacing's, format 1, which is what it is.
- `"SimulatorTracks"`, `"SimulatorCars"`: `simulator`, `native_key`, `native_name`, `track_id`/`car_id` (`ON DELETE SET NULL`), `mapped_at`, seen times; unique on `(simulator, lower(native_key))`. Not tied to a user.

**Identity**: iRacing's ids stay where they are (`"Tracks".track_key`, car names); nothing is copied, renamed or moved. `iracing_session_id` and `iracing_subsession_id` keep their names, and are 0 for other simulators. For another simulator, `track_key` is the site's track only through an explicit `mapSimulatorTrack`, and its own id is `native_track_key`. Similar names never map: focus areas are fractions of an iRacing lap and only fit the same layout. There's no mapping page yet.

**Protections**: only iRacing laps write `"Tracks"` lengths, locations, bounds and outlines, and `backfillTrackBounds` only reads iRacing's laps. Two risks to handle at the first adapter: `RecordedLaps`' fallback by name (`sameTrackName`) could match an unmapped lap whose name normalizes the same, and My Dashboard's offline lap key doesn't include the simulator, though it needs the same names and lap time to the millisecond to collide.

**Payload versions**: laps carry `payloadVersion`; none means 1. Old collectors keep working as they are, and a format newer than the site reads answers 422 `payloadVersionNotSupported`. Bump it only when a field changes meaning, and keep reading the old format. Adding fields needs no bump: Zod's `z.object` drops unknown keys, so a new collector works with an older site, and the site's columns have defaults.

## What's been proven

Run on 2026-11-01 on Windows, with no simulator. See `collector/RacingCoach.Collector.Tests/Golden/`, written from the code at commit 64815d5 before any refactoring, then frozen.

| Test | Result |
| --- | --- |
| Lap detection in 15 scenarios (resets, tows, gaps, replays, pit road, ...) | Same as baseline |
| Lap CSVs, byte for byte by SHA-256; `session.json` | Same; `session.json` gains `simulator` |
| Upload details and CSV, status code meanings | Same, plus `simulator`, `payloadVersion`, `adapterVersion`, `carKey` |
| The whole engine from an `.ibt` through the real SDK | Same files and log |
| iRacing through the canonical path (adapter, frames, tracker, `LapCsvFormat`) | **Byte-identical to iRacing's own path** |
| `FrameLapTracker` against `LapRecorder` in the 15 scenarios | Agree |
| Deliberate breaks to check the tests can fail (8: swapped column, changed threshold, dropped field, swapped wheel, zero for missing, ...) | All 8 caught, by 1-4 tests each |
| Old collector payloads, duplicates, position replacement, migration over existing rows, track isolation | Pass |
| Existing suites (retention, dashboard, consent, TV, broadcast, tire temps, lap events, engine bed, video director, rotation parity, track positions) | Pass |
| Production `next build`, release-style `dotnet publish` | Pass (67 MB single exe) |

`npm run test:collector`, and `npm run test:simulators` with `SIMULATORS_TEST_DATABASE_URL`.

**Live iRacing check (2026-11-01):** the site owner ran a standalone build (1.59.1, default path) on their iRacing PC, went through the checklist in [Deploying](#deploying-and-rolling-back), and reported that everything worked. This was a manual check, and its logs weren't reviewed here. The automated fixtures are still generated in iRacing's format, as no real `.ibt` was available to them.

**Not proven:**

- **`--simulator auto` against iRacing.** The live check used the default path, so `Probe` has only been tested against a stand-in for iRacing's shared memory.
- **Performance while driving.** The tracker handles an hour of 60 Hz frames much faster than real time and the pump stays bounded under a stalled consumer, but CPU and memory beside a running simulator weren't measured. iRacing's path gains no per-sample work.
- **ACC, beyond the channels the Spa recording checked**, and any other simulator. No other adapter exists, and every "documented" entry is still a reading of documentation. ACC's laps haven't been through the website (it refuses them until ACC is supported), and fuel being burned, wind, rain and online sessions are unchecked.

Not changed, and worth knowing: `LapWriter`'s and `LapUploader`'s queues are unbounded, as they always were. Writes are quick and upload items are small, as the telemetry is on disk, so memory only grows if the disk stalls. Bounding them could lose laps or block telemetry, so that's a decision to make with evidence. `FramePump` bounds the new path. Lap uploads aren't batched, by design.

## Adding a simulator

ACC next. Nothing in the shared code should need to change; if it does, that's worth stopping to look at.

1. **Read the publisher's documentation**, and fill in the simulator's `channels` in `simulators/capabilities.json`, with sources. Confirm the licence.
2. **Implement `ISimulatorAdapter`** in the collector project: `SimulatorId` from the matrix, `Probe` (cheap, read-only, checks the interface, not only the process), and `RunAsync` to convert into `TelemetryFrame`'s units and signs with `Units`, leaving what's missing null. Read on your own thread, and don't block in the sink. Give `LapTrackerOptions` the simulator's rate if its thresholds differ. For ACC, set `LapJustEnded` from `completedLaps` and `iLastTime`, and `LapValid` from `isValidLap`.
3. **Register it** in `SimulatorRegistry.Create`. Available only through `--simulator` until it's the default.
4. **Record real sessions** to fixtures: a clean lap, an out lap, a reset, a session restart, a replay, a known left turn, reverse gear. Test `AdapterContract.Violations` on them, and confirm each convention in the table above.
5. **Compare** to the simulator's own displayed lap times, and to a known track's expected lap distance.
6. **Fix the website first**: the `|| 0` in `lapSamplesFromText`, then show Not Available in Lap Compare, and hide coaching that depends on what's missing (for ACC: brakepoints in feet without a track length, steering, ride heights, GPS lines). Done for ACC on 2026-11-06 (see Missing values on the website above).
7. **Map tracks and cars** on purpose, each layout checked: the Coach page's Simulator Mapping (`src/components/SimulatorMappings.tsx`, `/api/coach/simulator-mappings`), from the simulator's catalog (`src/lib/simulatorCatalogs.ts`) and any track or car seen in laps. Mapping re-labels the laps already stored, and unmapping gives them their own names back. The page exists; ACC's tracks and cars still need mapping, each checked.
8. **Disable what can't be trusted**, by the matrix. The AI coaches read the CSV through `measureDebriefSession`, so check what they say with empty columns. Rotation Model calibrations don't transfer: each car needs its own, and an uncalibrated car already says UNKNOWN. Done for ACC on 2026-11-06: the Spa recording's lap, written as the collector writes it, through `measureDebriefSession`, `lapSegmentTimes` and `lapShifting` gives no NaN or infinite value, and steering, driving line and tire temperatures are left out. It also found two differences from iRacing's lap files, fixed in adapter 2 (below).
9. **Only then** change its status to `supported`, which is what lets the website accept its laps, and move live features across one at a time, each against iRacing's golden behavior. ACC: supported on 2026-11-06, with `minAdapterVersion` 2 so laps written before adapter 2 are refused. Live features not moved yet.

### For ACC specifically

Check first: `accG`'s frame, `steerAngle`'s sign, gear numbering, `wheelPressure`'s unit, `fuel`'s unit, and `smVersion` against the v1.8.12 document, as a contributor reports v1.9 exists. Also confirm how `packetId` behaves when the game is paused.

**Layout (done 2026-11-04, without the game):** `AccSharedMemory.cs` in Core reads the three pages from bytes, in ACC's own units, leaving conversion to the adapter. The document gives the fields' order and types but no offsets. The offsets come from that order with C's alignment (everything is 4 or 2 bytes wide, so `#pragma pack(4)` changes nothing; odd-length `wchar_t` arrays get 2 bytes of padding): physics 800 bytes, graphics 1588, static 820. PyAccSharedMemory's reader agrees on every field. `RacingCoach.Collector.Core.Tests` (plain net10.0, so it runs on a Mac too: `npm run test:collector-core`) builds pages from `AccDocumentedLayout.cs`, the document's field list generated from the PDF, and checks each field is read from its own place; moving any offset fails it. `AccCars.cs` is the document's appendices (names, max steering angle, max RPM, brake bias offset, broadcasting id), checked by script against the PDF; it stops at the 2022 Challengers Pack. Still to confirm in the game: real pages from a Spa session match this layout (dump them with the adapter's raw recorder), and the units and signs above.

**Adapter (written 2026-11-05, without the game; not yet run against ACC):**

- `AccFrameBuilder.cs` (Core) turns the pages into frames and the session. ACC has no session clock or matching sample counter in its pages, so frames are timed by the reader's own clock and `Tick` stays null (gaps are found by time). A frame whose physics `packetId` hasn't changed is skipped, so a pause or a repeated read isn't counted as a sample. Laps end on ACC's own events: `completedLaps` going up, with `iLastTime` as the lap time and whether `isValidLap` was false at any read since the line (`AccFrameBuilder.LapTrackerOptions`, picked up by `CanonicalLapPipeline` through `IHasLapTrackerOptions`). `LapNumber` is `completedLaps + 1`, like iRacing's `Lap`; `sessionIndex` is the session number.
- Every unit, sign and axis the PDF leaves open is a named constant in `AccConventions`, with what it assumes: gear numbering (0 reverse, 1 neutral, 2 first), `steerAngle`'s direction, `localVelocity`/`localAngularVel`/`accG` axes and signs, `heading`, `wheelPressure` in psi, `clutch` as the pedal. Correct a convention there after the Spa recording, never in the builder.
- Left out on purpose: the steering angle (ACC gives only the input, a share of the driver's wheel range), wind (0 in both Spa sessions), tire carcass temperatures (ACC has a core temperature only), off track and incidents (`numberOfTyresOut` is marked not used), track length (`trackSplineLength` is marked not used).
- `AccAdapter.cs` (collector) opens the three maps while `AC2-Win64-Shipping.exe` runs, reads them 60 times a second (with the Windows timer at 1 ms, so the samples are even), copies a page again if its `packetId` changed mid-copy, re-reads the static page and checks the process each second, and warns once when `smVersion` is neither 1.8 (the documented layout) nor 1.9 (checked against the Spa recordings). It's in the registry only when `--simulator acc` names it, never for `auto`, as detection beside a running iRacing isn't proven.
- **Adapter 3 (2026-11-06, collector 1.81.0): the steering wheel angle.** ACC's steerAngle is a share of the driver's wheel rotation (full lock read 0.752, not 1), which the shared memory doesn't give, so the collector is told it once with `--steering-range <degrees>` (saved as `steeringRange` in `collector.json`) and writes input times half of it; without it `SteeringWheelAngle` stays empty. Checked on the Spa recording: as a share of 900 degrees La Source is 216 degrees, a GT3's steering ratio against the front wheels' angle from yaw rate and speed, where a share of the Huracan's 310 degree lock (Appendix 5) would give 6:1. It's wrong if ACC's own Steer Lock setting differs from the range given. Test: `AccSpaRecordingTests`.
- **Adapter 2 (2026-11-06, collector 1.80.0): lap files as iRacing's** (`AccFrameBuilder.ForLapFile`, through `IShapesLapFiles` in `CanonicalLapPipeline`). Found replaying the Spa recording into a lap file:
  - ACC counts a lap at 0.99625 of its track spline at Spa, 27 m before the spline's 0, so a lap file started at 0.996, and every focus area (fractions of iRacing's lap, from its start/finish line) would be measured 27 m off. The frame builder now learns the timing line from the read where `completedLaps` goes up and counts the lap position from it; until ACC has counted a lap the spline's own is used, so only the lap in progress when the collector starts differs.
  - At the spline's 0 the position sticks at 1, then at 0, for about 4 reads each with the car moving; those reads are filled in by time.
  - ACC shows neutral for 3 to 7 reads (50-100 ms) in the middle of every shift (4, 0, 0, 0, 5), so the shift points found none. A neutral up to 0.3 s between two gears with the car moving keeps the gear before it; a real neutral (longer, or stopped) is kept.
  - The lap's samples now cover ACC's own lap time (154.144 s against 154.135 s). Tests: `AccSpaRecordingTests`.
- `ChannelGate.cs` (Core): a lap file only gets the channels the matrix marks `collected` (or `collectedAfterStint`) for its simulator; the rest are empty cells, which the website shows as no data. So ACC's laps carry only their structure (LapDistPct, Lap, SessionTime) until each channel is checked and marked collected. iRacing's laps pass through unchanged.
- `--record-raw` saves every page read to `Documents\RacingCoach\Raw\acc-<time>.accraw.gz` (`AccRawRecording.cs`: the static page when it changes, physics and graphics on every read, each with the reader's seconds). `AccRecordingImporter` plays one back through the same builder, which is how a recording becomes a test fixture.

**Proving it at Spa** (on the sim PC): `RacingCoach.Collector.exe --simulator acc --record-raw --no-upload`, then a few clean laps of Spa in a car the PDF lists (not the 992), one lap cut on purpose (invalid), a pit stop, and a pause. The log says where the recording went. From it, confirm each convention against what was done (full right lock, first gear, a known tire pressure in ACC's own UI, braking for La Source for `accG`'s longitudinal sign, Eau Rouge for the lateral and yaw signs), then mark each confirmed channel `collected` in `simulators/capabilities.json` and add the recording, cut to a lap or two, as a fixture.

**First Spa recording (2026-11-05):** 23 minutes of practice in the Lamborghini Huracán GT3 Evo, ACC shared memory **1.9** (the adapter's one-time warning). The 1.8 layout read every field sensibly (names, temperatures, pressures, speeds, laps), so 1.9 moved nothing the adapter reads; `surfaceGrip` stayed 0 throughout, likely unused in practice. Two laps (2:33.570 out lap, marked invalid; 2:34.135), several pauses (repeated `packetId`s, skipped), no pit stop. Checked against it:

- Gear: 1 standing still, 2 pulling away, 7 at the top of a six-speed car, so 0 reverse, 1 neutral, 2 first, as assumed
- Steering: +0.48 through La Source (a right hairpin), so +1 is right lock, as assumed. Full right lock wasn't reached (0.83)
- Yaw rate about y, + left: -0.8 rad/s through La Source; it tracks lateral g at 0.93 and steering at -0.94
- accG is the car's own g (x + left, y up, z + forward), not global: 1.4 g through La Source, matching speed × yaw rate; negative under braking
- **Changed:** accG's vertical has no gravity (0.02 g on average on the move), so 1 g is added (`VerticalIncludesGravity`); `heading` grows turning right (its rate is exactly minus the yaw rate), so it's negated (`YawSign`); `clutch` is engagement, 1.00 throughout driving, not the pedal (`ClutchIsPedal`)
- Tire pressure 26-27 hot, so psi; lap times match the time between ACC's line crossings

Its one valid lap, with 3 s either side, is `collector/RacingCoach.Collector.Core.Tests/Fixtures/acc-spa-huracan-gt3-evo-lap.accraw.gz` (4.4 MB), replayed by `AccSpaRecordingTests`.

**Second Spa recording (2026-11-05, 18:36):** 19 minutes, the same car and version: an out lap from the garage, five counted laps (2:31.192, 2:30.325, 2:45.130 with a trip off the track on purpose and the pit lane at its end, 2:58.242 through a pit stop, 2:30.470), a pause, and the wheel turned at low speed. Checked against it:

- **Bug fixed:** ACC resets `isValidLap` at the line (with `iCurrentTime`), and at 881.12 s and 1159.38 s that was a read before `completedLaps` went up, so the lap off the track was reported valid. `AccFrameBuilder` now latches a lap's validity from the line. The first recording's laps happened to be counted on the same read
- **Bug fixed:** when ACC counts a lap a read after the line, `FrameLapTracker` (which starts recording at the line) took that late event of the lap before as the end of a two-frame lap. A native event less than `MinLapSeconds` into the lap being recorded is now ignored
- The out lap from the garage crosses the line without a lap being counted; the tracker starts at that crossing, so the next lap is saved whole
- Fuel: 62 all session, `usedFuel` 0, so ACC burned none (likely a session setting). It's liters, whatever the document says: `fuelEstimatedLaps` 14.6 is exactly `fuel` 62 / `fuelXLap` 4.24, which the document gives in liters, and `maxFuel` 120 is the Huracán's 120 L tank. `FuelLiters` is now `fuel`, and `fuelLevel` collected
- Pit stop: `isInPitLane` from the pit entry (0.984 of the lap) to the exit (0.139), and from the garage to the exit; `isInPit` in the box for 34 s. The lap ending in the pit lane is an in lap
- `heading` is atan2(-x, z) of the world `velocity` to within 0.05 rad, so 0 is ACC's world +z. That's not north, but the website finds Yaw's zero from each lap's positions, so `yaw` is collected
- `abs` is only 0 or 1, in bursts under braking (into trail braking too), so `absActive` is collected
- Air 27.4 °C and road 28.8 °C, plausible, so `weather` is collected; `windSpeed` and `windDirection` read 0 in both sessions, so the builder leaves them null
- Steering: full lock read ±0.752 both ways at low speed, never ±1, so `steerAngle` is a share of the driver's wheel range, not the car's lock: an angle from `AccCars`' lock would be wrong. Standing still it reached only 0.44
- The in lap's frames span 0.6 s less than ACC's 2:45.130; the flying laps' match

The off-track lap, with 3 s either side, is `Fixtures/acc-spa-huracan-gt3-evo-off-track-pit-entry.accraw.gz` (4.8 MB), replayed by `AccSpaOffTrackRecordingTests`. Still to record: a session that burns fuel, wind, rain, and an online session.

## Importing telemetry files

`ITelemetryFileImporter` is separate from live adapters: no connection or lifetime, `CanRead` looks at the file's contents rather than its extension, and output goes to the same sink, so the same pipeline takes it. `AccRecordingImporter` implements it for ACC raw recordings (`--record-raw`); nothing reads simulators' own files yet. Note that a file plays faster than real time, so give `CanonicalLapPipeline` a larger `pumpCapacity`, or the pump will drop frames.

## Deploying and rolling back

Nothing has been committed, tagged or deployed. Suggested order:

1. **Website first.** `ensureUserSchema` adds the columns and tables on the first request after deploy. Old collectors are unaffected, and new ones work against an old site too, so the order doesn't matter for compatibility.
2. **Test the collector against iRacing, on your PC, before tagging**: `dotnet run` in `collector/RacingCoach.Collector`, then a practice stint and a short race. Check: laps upload; positions arrive after the stint; the coach speaks; overlays and brake beeps; Live Racing; race result; closing and reopening iRacing with the collector running. Compare a lap with an earlier one in Lap Compare.
3. **Then release** with a `collector-v*` tag, as usual. The self-updater delivers it to everyone at once, so step 2 is what stands between a problem and every user. Adding `npm run test:collector` to `.github/workflows/collector-release.yml` before the Publish step would be worthwhile; it was left out as a change to the release pipeline.

**Rollback**:

- Collector: release the previous code with a higher version number, as the updater only moves up. Local `session.json` files with the extra fields load fine in old collectors, which ignore them.
- Website: redeploy the previous commit. The added columns and tables stay, unused and harmless: old code doesn't name them, and their defaults fill new rows. Don't drop them, as they may hold laps' simulators by then. If it must be undone completely, nothing depends on them while only iRacing is accepted.
- Feature flag: there's none to turn off for iRacing, since the default path has no detection. `--simulator` is opt-in, and the website's `status` field controls which simulators' laps are accepted.
