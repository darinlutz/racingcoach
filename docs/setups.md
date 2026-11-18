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

## Wheel Alignment Engineering Comparison

On the Compare tab, above the Visual comparison (`src/components/AlignmentEngineeringView.tsx`, with
`TopDownToeDiagram`, `FrontCamberDiagram`, `RearCamberDiagram` (both `AlignmentCamberDiagram`), `AlignmentWheel`,
`AlignmentDataPanel` and `AlignmentComparisonSummary`; text in `setups.alignment` of the dictionaries): SVG drawings
of both setups' camber (front view, looking rearward; rear view, looking forward) and toe (top view), Baseline in cyan,
Comparison in amber, unchanged in grey; Baseline only / Comparison only / Overlay both; a 1×, 2×, 5×, 10× exaggeration
(default 5×) of the drawing only; the four corners' values; the selected wheel's analysis; and the list of changes.

- **Values** (`src/lib/alignmentGeometry.ts`, pure, `npm run test:alignment`): found in Compare's rows by key and box,
  never by label: `Camber` and `Caster` in a corner box (`LeftFront` ...), degrees only; `ToeIn`/`ToeOut`/`Toe` in a
  corner box is that wheel's toe, and `TotalToeIn` (or a toe key in a Front/Rear box) the axle's total, in degrees,
  mm or inches. Anything else that looks like alignment (another unit, a fraction, text, a second path for the same
  thing) is listed as unreadable, never drawn. Readings are left out
- **Toe**: the key name says which way is positive (`ToeIn`: toe-in); a plain `Toe` isn't drawn turned. Toe in mm is
  a distance, and iRacing doesn't say over what length it's measured, so it's drawn schematically
  (`SCHEMATIC_DEG_PER_MM`) and said so; only toe in degrees is drawn at its angle. iRacing sets GT3 front toe as one
  axle total: the drawing splits it evenly between the wheels, labelled as an illustration, and the wheels show no
  value of their own
- **Ask Setup Engineer**: posts `/api/setups/engineer` with `focus: 'alignment'`; the route builds the alignment facts
  itself from the two revisions (`alignmentEngineerFacts`, `ALIGNMENT_ENGINEER_RULE`), so nothing the browser sends
  is taken as a value. Same membership, rate limit, model control and saved proposal as the Setup Engineer tab; the
  answer shows under the drawings. Only on the button, never automatically
- **More accurate toe** would need, per car, the length iRacing measures toe over (to turn mm into degrees) and how
  it splits front total toe between the wheels; neither is in the session info

## Engineering system tabs

Under the main tabs, a row of eight system tabs (Suspension, Brakes, Tires, Aerodynamics, Drivetrain, Fuel,
Electronics, Other; `SYSTEM_ICONS` in `SetupsWorkspace.tsx`), each a dashboard of the same two revisions Compare has
(the pick is shared), designed after the Lovable project `darinlutz/screenshot-match`. They share
`SetupFocusComparison.tsx` (pickers, `/api/setups/compare`, Ask Setup Engineer) and `engineeringUi.tsx` (toolbar,
sections, sliders), the alignment's colors and drawing classes (`align-*`, `--align-*` in `globals.css`), and its
rules: values found by key in Compare's rows, kept in iRacing's own units and decimals, never invented; readings
(iRacing's calculations and last-run measurements) shown and labelled apart from settings and not counted as changes;
every drawing schematic and labelled so, the exaggeration changing the drawing only; nothing ever called better. Ask
Setup Engineer posts `focus` (the tab's name) and the route builds that system's facts from both revisions itself
(`FOCI` in `src/app/api/setups/engineer/route.ts`).

- **Suspension** (`SuspensionEngineeringView.tsx`, `src/lib/suspensionGeometry.ts`, `npm run test:suspension`):
  ride heights, spring rates, bump rubber gaps, perch offsets and corner weights per corner, dampers per axle or
  corner (low/high speed, compression/rebound, clicks) and ARB blades or settings. A 3D axonometric overview, side,
  front and rear elevations and a corner cutaway; ride heights drawn to an exaggerated scale about their mean (the
  only thing drawn to a scale); Hooke's-law spring compression for a hypothetical load in the spring's own units;
  bump rubber contact along the gap; rear minus front height difference, never a rake angle (no wheelbase)
- **Brakes** (`BrakeEngineeringView.tsx`, `src/lib/brakesGeometry.ts`, `npm run test:brakes`): bias, master cylinders,
  pads, ABS and the LED strip. `BrakePressureBias` alone is split front/rear (iRacing's front share of line pressure);
  bias deltas in percentage points; master cylinder area and pressure for a hypothetical piston force, mm only; the
  ABS sequence is the same illustration for both settings; the LED is lighting, left out of every calculation and of
  the engineer's advice. Hydraulic circuits have their own colors (`--brake-front`, `--brake-rear`), never a setup's
- **Tires** (`TireEngineeringView.tsx`, `src/lib/tiresGeometry.ts`, `npm run test:tires`): the tire type and starting
  pressures (settings), and the last run's `LastHotPressure`, `LastTemps{OMI,IMO}` (ordered inner/middle/outer by the
  key) and `TreadRemaining` (readings). Pressures shown in kPa, psi or bar, converted exactly; balance needs both
  corners for an average and all four for extremes; heat bands on a scale relative to the readings shown (`--tire-heat-*`),
  never an operating window; cross-section, contact patch and inflation demo are conceptual; the gas law runs on a
  hypothetical absolute reference only
- **Aerodynamics, Drivetrain, Fuel, Electronics, Other** (`SetupDashboardView.tsx`, `AeroDashboard.tsx`,
  `DrivetrainDashboard.tsx`, `FuelDashboard.tsx`, `ElectronicsDashboard.tsx`, `OtherDashboard.tsx`;
  `src/lib/setupDashboards.ts`, `npm run test:setup-dashboards`): every parameter of `setupYaml.ts`'s category, with
  the keys the drawings know given a role. Aero: wing angle and splitter (settings) and the aero calculator's ride
  heights at speed, wing setting and `FrontDownforce` share (readings); no downforce or drag. Drivetrain: preload,
  friction faces (not plates), gear stack. Fuel: the level in litres (US gallons converted); mass only for a density
  the driver types; a race plan only from the driver's laps, consumption and reserve. Electronics: every numeric
  control as a dial (ABS borrowed from Brakes); an illustrative TC trace. Other: an illustrative throttle curve for a
  throttle shape setting (no car's map), then whatever no other category takes

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
