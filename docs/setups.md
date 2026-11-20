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

The Alignment tab, the first of the engineering system tabs (`src/components/SetupAlignment.tsx` on `SetupFocusComparison.tsx`, drawn by `src/components/AlignmentEngineeringView.tsx`, with
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

Under the main tabs, a row of nine system tabs (Alignment, Suspension, Brakes, Tires, Aerodynamics, Drivetrain, Fuel,
Electronics, Other; `SYSTEM_ICONS` in `SetupsWorkspace.tsx`), each a dashboard of the same two revisions Compare has
(the pick is shared), designed after the Lovable project `darinlutz/screenshot-match`. They share
`SetupFocusComparison.tsx` (pickers, `/api/setups/compare`, Ask Setup Engineer) and `engineeringUi.tsx` (toolbar,
sections, sliders), the alignment's colors and drawing classes (`align-*`, `--align-*` in `globals.css`), and its
rules: values found by key in Compare's rows, kept in iRacing's own units and decimals, never invented; readings
(iRacing's calculations and last-run measurements) shown and labelled apart from settings and not counted as changes;
every drawing schematic and labelled so, the exaggeration changing the drawing only; nothing ever called better. The
car under the drawings is the compared setups' own, from the engineering car drawings (docs/car-views.md), or the
generic GT3-class car, labelled, until it has approved drawings. Ask
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

## iRacing setup collection

The **iRacing Setups** tab (`carSetups`, after My Setups; `src/components/SetupCarLibrary.tsx`) is a shared library
of iRacing's own setup files, copied from the sim PC automatically and by the collector's **Get Car Setups** button. It's separate from
My Setups (each user's own `"Setups"`), and for **Admins only** until the licensing and redistribution of iRacing's
setups is decided: the page leaves the tab out for anyone else, its routes answer 404, and the collector's routes 403.

- **Collector** (from 1.100.0): the button beside Brake Practice shows only when `/api/collector/me` says Admin
  (`CollectorEngine.IsAdmin`). `CarSetupsWindow` runs `CarSetupImporter`: `SetupFolderScanner` (Core, tested on any OS)
  looks for `iRacing\setups` under `%USERPROFILE%\OneDrive\Documents`, `%OneDrive%\Documents`, the Documents known folder,
  then `%USERPROFILE%\Documents`; scans every car folder (from 1.101.0; 1.100.0 scanned only `ferrari296gt3`) and up to 3
  subfolders, sending more than 1000 setups as several imports; pairs each `.sto` with the `.htm` of the same name (case aside); reads files sharing them with iRacing and
  OneDrive (online-only files download as they're read), retrying while one is locked or still being written, and never
  moves, renames, changes or deletes them. Folders that are links aren't followed. Progress is in the user's language,
  and the activity log gets the same in English. Setups of a car folder that isn't a Car Data car are skipped, said once
  per folder, not counted as failures
- **Automatic** (`CarSetupSync.cs`, from 1.101.0): for Admins, the same import runs quietly in the background: once per
  upload key per run, when a `.sto`/`.htm` in the setups folder is added or changed (a FileSystemWatcher, 30 s after the
  last change), and hourly when the folder's fingerprint (paths, sizes, times written) differs from the last good run's.
  The activity log gets problems (each once per run) and, when something was imported or failed, the summary. One run
  at a time: the button waits for an automatic run to finish
- **Import** (`src/lib/carSetupLibrary.ts`): `POST /api/collector/car-setups/plan` lists every setup with its files'
  names, sizes and SHA-256 hashes and answers new, changed, unchanged or unresolvedCar; the collector sends only new and
  changed ones, both files, to `POST /api/collector/car-setups` (multipart `meta`, `sto`, `htm`), then
  `POST /api/collector/car-setups/finish` with what failed. The server checks the Admin role on each, the files against
  the listed hashes and sizes, the names (`carSetupLibraryRules.ts`: no path separators, `..`, reserved or control
  characters), the `.sto`'s container (`readStoFile`: only iRacing's known layout is taken; anything else, a layout not seen before included, is refused) and that the `.htm` is text
- **Car**: the car folder is iRacing's car path; it's a Car Data car only when that path's names in `IRACING_CARS`
  match exactly one `"Cars"` row (accents, case and punctuation aside); otherwise the folder is reported unresolved and
  its setups aren't imported (`resolveCarFolders`). No car is ever created
- **Storage**: the private telemetry R2 bucket (`telemetryStore()`, server-only token), at
  `iracing-setups/<car folder>/<sha256>.sto|.htm`: content-addressed, so identical bytes are one object, a retry or a
  second import writes nothing, and a re-saved setup is a new object. Order per setup: a `pending`
  `"TelemetryObjectCleanup"` entry, the object (skipped when one of that size is already there), a HEAD to check it, then
  the row and the entry's removal in one transaction, so a failure never leaves a catalog entry without its files. A
  replaced or deleted setup's old objects are queued by the `"CarSetups"` triggers, and the cleanup worker deletes one
  only when no setup references its key. For local development without R2, `CAR_SETUP_DEV_STORAGE_DIR` (a folder on the
  computer, never on the live server) stands in
- **Catalog**: `"CarSetups"` (`carSetupLibrarySchema.ts`): one row per simulator, car folder and setup path (case aside),
  with the car, both files' names, keys, hashes and sizes, `sto_info`, `htm_parse_status` (`parsed`, `empty`, `failed`,
  `missing`) and `htm_parsed`, `version` (up by one each time its files change), `provenance` and who imported it.
  `"CarSetupImports"`: each press, with its counts, unresolved folders and failures. Both in the privacy inventory with
  the other content Admins upload
- **Provenance**: nothing in a `.sto` or `.htm` says who made a setup, so every import is `unknown`; an Admin can mark it
  `official` (once checked to be iRacing's own) or `user` in the tab (`PATCH /api/setups/car-library/[id]`)
- **The .htm export** (`src/lib/setupHtm.ts`, pure): iRacing's HTML 4 export, tokenized (never rendered or put in a DOM):
  the title heading's car path, setup name and track; each `<H2><U>BOX:</U></H2>`; each `Label: <U>value</U>` with
  continuation lines (a list such as a tire's three temperatures, or `of <U>3.090 in</U>`); headings with no colon as
  the box's description; the Notes section. UTF-8, else Latin-1. Values keep their labels, units and box as written,
  numbers read with `readValue`, categories and readings from `setupYaml.ts`'s rules plus a few of the export's own
  (`HTM_READING_KEYS`). Boxes repeat (LEFT FRONT for tires and chassis), so a value's path is its box and label in
  order, with `#2` for a box seen again. Lines that don't fit become warnings, never values. Tested against five real
  exports (`scripts/fixtures/setups/htm/`, MIT, from CarTunes)
- **Page**: a car picker (cars with imported setups), the table (Setup, STO, HTM, Imported, Origin, View / Download STO /
  Download HTM), View's values by category under iRacing's labels, and the latest imports with their failures.
  Downloads stream through `GET /api/setups/car-library/[id]/file?kind=sto|htm` after the Admin check, checked against
  the stored hash, always as an attachment (`application/octet-stream`, a sandbox CSP), so an `.htm` never renders on
  the site. `GET /api/setups/car-library?car=`, `GET`/`PATCH /api/setups/car-library/[id]`
- **Not yet**: Car Data cars for the unresolved folders (the imports list them),
  showing the library to drivers (needs the licensing decision), and linking a library setup to the per-user
  Setups' revisions. A `.htm` older or newer than these exports may need more rules; its warnings show what didn't fit
- **Tests**: `npm run test:car-setup-library` (the parser and rules, then the import against a local Postgres with
  `CAR_SETUPS_TEST_DATABASE_URL`), the collector's `SetupFolderScannerTests` (`npm run test:collector-core`)

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
