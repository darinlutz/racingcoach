# Setups

The Setups page (`/setups`, the sidebar's Setups link) keeps a driver's iRacing car setups: what the telemetry
collector sees loaded in iRacing, the `.sto` files they upload, how two setups differ, the Setup Engineer's advice on
them, iRacing's inspection results and every revision. Signed-in users only; every query filters by the user's own ID.

## Where the values come from

**iRacing's session info, through the collector.** iRacing's session info YAML has a `CarSetup` section: every value
of the loaded setup exactly as the garage shows it, with its unit (e.g. `SpringRate: 223 N/mm`, `BrakePressureBias:
51.00%`), nested by garage tab and box. The keys differ from car to car. With it, `DriverInfo` has
`DriverSetupName` (e.g. `fixed.sto`), `DriverSetupIsModified`, `DriverSetupLoadTypeName` (`iracing` for iRacing's own
setups) and `DriverSetupPassedTech` (iRacing's inspection: 1 passed), and `WeekendInfo.WeekendOptions.IsFixedSetup`
says whether the session is a fixed setup session.

The collector (`SetupCapture.cs`, from 1.97.0) reads the raw YAML through the SDK's `OnRawSessionInfoUpdate`, cuts
out `CarSetup`, adds those fields from `OnSessionInfoUpdate` and posts it to `POST /api/collector/setup` whenever any
of it changes (`CarSetup.UpdateCount` goes up with each garage or in-car change). An unchanged setup isn't sent again;
only the newest capture waits to be sent; nothing is kept on disk. Played-back `.ibt` files don't send unless
`--upload`.

Values are kept as iRacing wrote them (`raw`) and, when the text is one number and a unit, as a number and unit
(`src/lib/setupYaml.ts`). Parameters are identified by their path (`Chassis.LeftFront.SpringRate`). Which values are
**readings** (measured or worked out by iRacing: corner weights, last hot pressures, tread, temperatures, the aero
calculator, weight distribution) rather than settings is decided by key name, as the YAML doesn't say; readings are
never proposed or changed. In-car adjustments are those in the `InCarAdjustments` box. Units are whatever the driver's
iRacing displays; nothing is converted.

**Fixed setups.** A setup's name never decides it. iRacing ships a GT3 setup named `fixed.sto` that loads in open
sessions too (this repository's fixture is one, with `IsFixedSetup: 0`). `fixedSetupSession`
(`src/lib/setupInspection.ts`) uses the session flag, else a load type of `fixed`, else "unknown". The Driver Radio's
Setup Engineer now uses it too (`isFixedSetup`).

## The .sto format

Read by `src/lib/stoFile.ts` from iRacing's own files (a BMW M4 GT3 EVO `fixed.sto`, 18,238 bytes):

| Offset | Size | What |
|---|---|---|
| 0 | 4 | container version (3) |
| 4 | 4 | bytes from offset 8 to the end of the notes |
| 8 | 4 | payload bytes (a multiple of 16) |
| 12 | 4 | notes bytes |
| 16 | payload | **the setup's values, encrypted** (no structure, ~7.9 bits of entropy per byte) |
| … | 32 | a signature: not a plain SHA-256, SHA3-256 or BLAKE2s of any part of the file |
| … | notes | the car's setup notes, UTF-16LE, null terminated |
| … | 24 × n + 8 | records (`1`, `16`, 16 bytes): identifiers of unknown meaning, then 8 zero bytes |

So an uploaded `.sto` is **partially decoded**: its container, notes and identifiers are read, its values aren't.
They become known when iRacing loads the file: the collector's capture goes to the user's setup of the same file name
and car (`recordCapture` in `src/lib/setups.ts`), and an upload joins a setup the collector has already seen under its
name. Files that don't fit the layout are **unsupported** or **failed**, and kept byte for byte either way.

### Export: not possible

RacingCoach cannot write a `.sto` iRacing would accept: the values are encrypted and the file is signed with a key
only iRacing has. Getting round that would mean breaking iRacing's protection, which RacingCoach doesn't do. Instead a
revision's changes download as a **change sheet** (`GET /api/setups/revisions/[id]/change-sheet`) to set in the garage
by hand; when the driver then saves and loads it, the collector's capture shows its values, and a revision whose
adjustable values match exactly is marked as seen in iRacing, with its inspection result. If iRacing ever offers a
supported way to write setups, the writer goes behind `STO_PARSER_VERSION` with the round-trip tests the original
specification lists.

## Data

Tables in `src/lib/setupSchema.ts`, created by `ensureUserSchema`, additive only, every one `ON DELETE CASCADE` from
`"Users"`: `"Setups"` (one per setup; the original `.sto` in `sto_file`, at most 512 KB, in Postgres: setups are
small, and keeping them out of the telemetry bucket keeps them clear of lap retention and its cleanup), `"SetupRevisions"`
(each version, never changed; `settings_sha256` fingerprints the adjustable values), `"SetupValues"` (one row per
parameter), `"SetupInspections"` and `"SetupProposals"`. Not touched by lap retention: kept until the user deletes them.
In the privacy inventory (category `setups`), Download My Data and Request Data Deletion.

A capture whose adjustable values equal the setup's latest capture only refreshes its readings; different values make
a new revision (at most 100 captures per setup are kept, oldest first out). Limits: 300 setups per user, 400 revisions
per setup, 240 captures and 60 uploads an hour (`ABUSE_LIMITS`).

**Linked laps** (`readLinkedLaps`): laps of the same account, car and iRacing subsession completed while a capture was
loaded, unexpired. Compare shows them with the caveat that lap times aren't the setup's alone; the Setup Engineer gets
them and their understeer and oversteer.

## Setup Engineer

The existing Setup Engineer (`src/lib/setupEngineer.ts`'s `setupWorkbenchAnswer`, AI feature `setupEngineer`, the
same rate limit, model control and knowledge base as the radio's). Silver and Gold members and Admins only, refused
before any AI call. It gets the revision's values as `path | value | setting or reading | in-car or garage`, the
comparison's differences, recent changes, linked laps, and the conditions when the driver is in that car right now.
It answers findings, hypotheses and recommendations separately, and proposes changes that `checkProposals`
(`src/lib/setupChanges.ts`) keeps only when they name a real setting by path with a number in its own unit, in-car only
in a fixed setup session. iRacing doesn't share legal ranges, so every proposal says so. Proposals are pending until
the driver accepts or rejects each; the accepted ones make one new revision.

## Inspection

iRacing's own result only (`DriverSetupPassedTech`; 1 is passed, as seen in captures, 0 read as failed, anything else
unknown, never assumed passed). iRacing gives no reason for a failure. RacingCoach's **Preliminary Validation**
(`PRELIMINARY_RULES` in `src/lib/setupInspection.ts`) is a rules engine with no car rules yet: a limit goes in only
when someone has verified it against the car in iRacing, with its source. It never claims a pass.

## Tests

`npm run test:setups`: the parsers, comparison, proposals and inspection rules (with the real `CarSetup` fixture,
`scripts/fixtures/setups/`), then the data against a local Postgres with `SETUPS_TEST_DATABASE_URL` (see
`scripts/setups-db.test.mjs`). `e2e/setups.spec.ts` drives the page (`npm run test:e2e`). The collector's
`SetupCaptureTests` check the section extraction.
