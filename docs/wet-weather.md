# Wet-Weather Intelligence

The Setup Engineer, Race Engineer, In-Car AI Coach and Debrief Coach know the track conditions and the tires on the car, and use the wet-weather part of the Race Engineering knowledge base (`docs/race-engineering-rag.md`) when the track is damp, wet or drying. Everything they're told about the weather comes from the simulator, never from a model. A dry session works exactly as before.

## What iRacing gives

Checked against the SDK the collector uses (SVappsLAB.iRacingTelemetrySDK 2.5.0) and iRacing's [2024 Season 2 release notes](https://support.iracing.com/support/solutions/articles/31000172630-2024-season-2-release-notes-2024-03-05-01-), which introduced rain.

| What | Where | Collected |
|---|---|---|
| Rain intensity | telemetry `Precipitation` (0-1, measured at the start/finish line) | from 1.54.0 (live), 1.94.0 (laps) |
| Track wetness | telemetry `TrackWetness` (`irsdk_TrackWetness`: 0 unknown, 1 dry, 2 mostly dry, 3 very lightly wet, 4 lightly wet, 5 moderately wet, 6 very wet, 7 extremely wet) | 1.54.0 / 1.94.0 |
| Declared wet | telemetry `WeatherDeclaredWet` | 1.54.0 / 1.94.0 |
| Track and air temperature, humidity, wind, skies | `TrackTempCrew`, `AirTemp`, `RelativeHumidity`, `WindVel`, `WindDir`, `Skies` | 1.40.0 (laps), 1.54.0 (live) |
| Static or dynamic weather | session info `WeekendInfo.TrackWeatherType` | 1.54.0 |
| Fitted compound | telemetry `PlayerTireCompound` (an index) | **1.94.0** |
| Compound picked for the next stop | telemetry `PitSvTireCompound` (an index; not on the car yet) | **1.94.0** (live) |
| The car's compounds | session info `DriverInfo.DriverTires[]` (`TireIndex`, `TireCompoundType`, e.g. "Hard", "Wet") | **1.94.0** |

What iRacing **doesn't** give apps:

- **A forecast.** The sim's Weather tab shows one, but neither telemetry nor session info has it, and there's no supported interface that does. Nothing is scraped. `forecast.available` is always false; the agents say no forecast is available. The only look ahead is a *projection* of the observed trend over the last 5-15 minutes (or "no change" for static weather), always labelled as not a forecast.
- **Water depth or standing water.** `standingWater` is always `notExposed`; the agents are told not to claim it.
- **A compound per corner.** `PlayerTireCompound` is one value for the car; `perCorner` is `notReported`. iRacing changes compounds as a set.
- **ABS or traction control activity in live data.** Lap files have `ABSActive`, but there's no traction control channel, so TC intervention is only ever inferred.

ACC's shared memory has a compound name (`tyreCompound`, e.g. `wet_compound`) and rain intensity; the weather context accepts a compound name (`TireInput.compoundName`), but the collector doesn't send ACC's yet.

## The weather context (`src/lib/engineering/weatherContext.ts`)

One pure module, shared by every agent:

- `buildWeatherContext` turns readings into a `WeatherContext`: each value with its raw reading, units, source variable and status (`available`, `unavailable`, `stale`, `notExposed`); the fitted and next-stop compounds with a confidence (`high` when the index names a compound of this car, `low` with only an index, `none` when not reported); the car's compounds and whether it has wets; the track condition (`dry`, `damp`, `wet`, `veryWet`, `unknown`, from `TrackWetness`, else rain); the trend; the forecast (unavailable) and projection; a tire mismatch (`slicksOnWet`, `slicksOnDamp`, `wetsOnDry`, `wetsOnDrying`, `noWetTires`); and warnings for conflicting readings (declared wet but reads dry, rain on a dry-reading surface, static weather that's changing, a compound not in the car's list).
- `weatherContextFromLive` builds it from the live state (`readEngineerSnapshot`); it's stale after 15 s (`WEATHER_STALE_MS`, the live state's `STALE_MS`). Stale readings are reported as not current, and `assessWeather` gives null for them, so retrieval, the diagnosis and the alerts treat them as unknown.
- `weatherContextFromLaps` builds it from a session's recorded laps (the newest lap's conditions and the change since the first). Lap conditions are history, never "now".
- `weatherFacts` is what an agent's prompt gets: observed values marked as observed, the tires, the trend, "Forecast: not available", the projection labelled as such, what isn't measured, and the mismatch.

## Knowledge (`src/lib/engineering/wetWeatherCorpus.ts`)

37 records, added to the starter corpus (73 in all), in the same tables as before: no new database or vector store. All are original text, `ai_drafted` (to be reviewed on the Admin page), with no exact settings, ranges, crossover temperatures or lap-time thresholds. Seven also cite iRacing's 2024 Season 2 release notes (`iracing-2024s2-release-notes`, `public-docs-link-only`) for how iRacing's rain works.

- Vehicle dynamics: wet grip and the friction circle, weight transfer, aquaplaning, tire temperature and pressure, tread and water, aero vs mechanical grip, rain intensity and track temperature
- Technique: braking, steering and entry speed, throttle, traction and gears, grip changing between corners and laps
- Lines: `wet-line-selection` (off the rubber can be faster, not always)
- Braking: `wet-brake-bias` (rain alone is no reason to move the bias rearward), front vs rear demand, `dx-wet-rear-instability-braking`, `dx-wet-abs-intervention`
- Setup: suspension, ride height and aero, `wet-diff-adjustments`, `wet-tc-tuning`, tires/alignment/engine, `wet-fixed-setup`
- Tires: when wets are right, `dx-wet-tire-mismatch-slicks`, `dx-wet-wets-overheating-drying`, slicks in the damp, `dx-wet-crossover-slicks-to-wets`, `dx-wet-crossover-wets-to-slicks`, `wet-no-wet-tires`
- Diagnosis: `dx-wet-entry-understeer`, `dx-wet-exit-oversteer` (GT3), `dx-wet-tc-intervention`, `dx-wet-aquaplaning`
- Racecraft: visibility and traffic, starts and pits, weather strategy; `wet-iracing-tempest`

Every record has the `wetWeather` component. New symptoms: `aquaplaning`, `lowGrip`, `tireCrossover` (with words for them in English, Portuguese, Spanish and German).

## Retrieval and diagnosis

- `applies` lets a `wetWeather` record in only when the conditions are damp, wet or drying, the tires don't suit the track, wet tires are fitted, or the question is about rain, wet tires or aquaplaning. With no weather, or a dry track on slicks, retrieval is exactly as before (the 39-question benchmark is unchanged: 85% / 100% keywords, 95% / 97% hybrid).
- On a wet track a wet record gets +2.5 when it's about the question (+1 when it isn't), so the wet record of a problem leads its dry one. A mismatch adds `tireCrossover` (and `tireOverheating` for wets on a drying track); a very wet track adds `aquaplaning`.
- `diagnose` takes the weather: on a wet track it uses the wet diagnosis record; slicks on a wet track (or wets on a dry one) make the tires the focus (`conditionsNote`), keep only in-car changes and put the tire change first; wets on a drying track is a possibility to check, not a decision.

## Agents

| Agent | Weather from | What changes |
|---|---|---|
| Setup Engineer | live update | weather facts in its prompt; the knowledge facts now actually reach its prompt (before, it computed them and never sent them); `wetSetupRule` when wet: conditions and tires first, then fixed or open, symptom, cause, change, test; slicks in rain is the tires before suspension; never slicks without evidence of drying; bias depends on the symptom; no blanket softer/higher/more downforce |
| Race Engineer | live update | weather facts; `wetEngineerRule`: observed vs projection, no forecast, tire calls only on evidence |
| In-Car AI Coach callouts | live update | `wetCalloutFacts` only when wet (dry prompts unchanged): compare with the driver's own wet laps, never call earlier braking a mistake just because it's wet |
| Debrief Coach | recorded laps' conditions (the page sends them) | the session's weather in the request; on a wet or changing session, coach it as one |

The `get_engineering_knowledge` tool gets the weather too, for all three lap-data agents. Every agent's knowledge lookup is recorded in server memory (`knowledgeUsage.ts`) with the model configured for its feature.

## In-car weather alerts (`src/lib/engineering/weatherAlerts.ts`)

Fixed rules, no AI call, no latency on the telemetry: `slicksOnWet`, `rainStarted`, `rainHeavier`, `wetsOnDrying`, `trackDrying`, `rainEasing`, most important first. An alert needs fresh readings and the driver in the car, must hold for 20 s, waits 90 s after any other and 5-15 minutes after the same kind. They run in `recordLiveUpdate` and go out with the live update's `messages`, which collectors from 1.53.0 already say in the coach voice; words in `coachSpeech.weather` in all four languages. Only for drivers who have the In-Car AI Coach (Silver, Gold, Admins) while Enable AI Features is on. Telemetry-based alerts ("throttle earlier than your reference in this wet corner") come through the lap callouts, from the data.

## Collector (1.94.0)

`PlayerTireCompound` and `PitSvTireCompound` in the telemetry list; `DriverInfo.DriverTires` read into `SessionContext.TireTypes` and `LiveRacing.SetTireTypes`; each live update has `tires: { compound, pitCompound, available }`; each lap's `conditions` has `precipitation`, `trackWetness`, `declaredWet`, `tireCompound`, `tireCompoundType`, left out of the JSON when null so iRacing laps without them, and the golden files, are byte-for-byte as before. Weather alerts are logged as `In-Car AI Coach: …`.

## Database

No migration. Lap conditions are JSONB (`"CollectorLaps".conditions`); the new keys are just there for laps from 1.94.0. The knowledge goes into the existing `Engineering*` tables.

## Admin

Race Engineering Knowledge: **Wet-weather documents only** filter; **Test retrieval** takes track conditions (dry, damp, wet, very wet, drying) and fitted tires, and shows the weather facts the agents get; **Live weather** shows each live driver's context (condition, rain, wetness, compound detected and its source, next-stop compound, the car's compounds, freshness, mismatch, warnings, forecast availability); **Recent knowledge use** lists the agents' last 100 lookups (agent, model, weather, question, documents). Reindex and Load starter corpus work as before and include the wet records.

## Deployment

1. Merge; CI runs `npm run test:wet-weather` with the other suites.
2. Deploy the site. Agents get the wet records at once from the starter corpus in code (keywords only).
3. Admin → Race Engineering Knowledge → **Load starter corpus**, then **Embed new chunks** (about US$0.0004 for all 73), for hybrid retrieval from the database.
4. Release the collector: `git tag collector-v1.94.0`, push the tag. Until drivers update, the tire compound is unknown and the agents say so; rain and wetness already come from 1.54.0.
5. Review the 37 drafted records and mark them reviewed.

## Rollback

Revert the commits. With the code reverted, wet documents in the database still exist but nothing tags a session as wet; deactivate them on the Admin page (Wet-weather documents only, then Deactivate) or leave them. Collectors 1.94.0 keep sending the extra fields, which older site code ignores.

## Tests

`npm run test:wet-weather`: 31 pure tests covering the 18 specified scenarios (dry/slicks unchanged, wet/wets, wet/slicks, drying/wets, rain increasing and decreasing, missing compound, missing forecast, fixed and open setups in rain, wet entry understeer and exit oversteer, ABS and TC intervention, standing water, crossovers both ways, stale and conflicting data, a car without wets), the corpus's rules, lap and live contexts, and the alerts' confirmation, priority and cooldowns.

## Known limitations

- No forecast from iRacing; the projection is a trend only.
- No water depth, standing water or per-corner compound; no traction control channel.
- Tire compound only from collector 1.94.0; ACC's compound isn't sent yet.
- Laps from before 1.94.0 have no rain, wetness or compound; dropped CSV files have no conditions at all.
- The 37 wet records are AI-drafted and unreviewed. They cite iRacing's release notes for iRacing facts only; there are no tire-manufacturer or car-manual sources yet.
- Debrief Coach's recorded laps list doesn't show rain or the compound yet (the coach gets them).
