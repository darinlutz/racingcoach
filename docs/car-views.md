# Engineering car drawings

The car under the Setups page's engineering drawings: one shared system, so each car is drawn the same way in
every tab, in the right view, with its tires drawn the way that view sees them. Every car shows the built-in generic
GT3-class drawing (labelled "Generic vehicle") until an Admin uploads, reviews and activates drawings of its own. The
Lamborghini Huracán GT3 EVO is the intended first car; no drawings of it exist yet (see Limitations).

## Inventory of vehicle drawings

| Where | Component | View | Uses the shared system |
|---|---|---|---|
| Compare: Visual comparison, between the four corner panels | `SetupCompare.tsx` (`CarBody`) | top, miniature | yes (`EngineeringCarView variant="miniature"`) |
| Alignment: top view (toe) | `TopDownToeDiagram.tsx` | top | yes, wheels hidden (the toe wheels are the overlay) |
| Alignment: front and rear views (camber) | `AlignmentCamberDiagram.tsx` | front, rear | yes, wheels hidden (the camber wheels are the overlay) |
| Suspension: ride height side, front and rear | `RideHeightDiagram.tsx` | left side, front, rear | yes, with its own wheels (tire widths end on) |
| Aerodynamics: the car from the side | `AeroDashboard.tsx` (`AeroCar`) | left side | yes, aero hidden (the wing per setup and the splitter are the overlay) |
| Brakes: bias car | `BrakeEngineeringView.tsx` (`BiasCar`) | top | yes, wheels hidden (the brake shares are drawn there) |
| Tires: four-corner overview | `TireFourCornerOverview.tsx` | top | yes, wheels hidden (the gauges are the tires, set outboard) |
| Suspension: 3D overview | `SuspensionCarOverview.tsx` | axonometric | no: not one of the five views; a schematic of the suspension |
| Suspension: corner cutaway, springs, dampers, bump rubbers | `SuspensionEngineeringView.tsx` | schematic | no: mechanical schematics, not the car |
| Brakes: hydraulic plan, calipers, master cylinders, ABS | `BrakeHydraulicOverview.tsx`, `BrakeEngineeringView.tsx` | schematic | no: mechanical schematics |
| Drivetrain, Fuel, Electronics, Other | their dashboards | schematic | no: mechanical schematics and charts, no car body |
| Tires: cross-sections, contact patch, tire type | `TireEngineeringView.tsx`, `TireCrossSection.tsx` | tire only | no |
| Lap Compare: Tire Temp car | `GT3CarTopView.tsx` | top | not yet (see Limitations) |
| Lap Compare: Tire Pressure, Ride Heights, Balance cars | `DashboardCarView.tsx`, `RideHeightDashboard.tsx` | top, side, rear | not yet |
| Lap Compare: 3D view's car | `TrackLineMap3D.tsx` (`ScenegraphLayer`), else `src/lib/carModel3d.ts` | 3D model | the 3D car models (docs/car-models.md): the car's approved GLB, else the generic mesh |
| Suspension: Interactive 3D | `src/components/car3d/Car3DViewer.tsx` | 3D model | the 3D car models (docs/car-models.md) |
| My Dashboard, Cars & Tracks car pictures | `public/assets/carPics/` | photographs | no: pictures, not engineering drawings |

## Conventions (`src/lib/carViews/views.ts`)

Five views, each its own drawing; corners are always the car's, never the screen's.

| View | Seen from | Screen order of the corners | Tires drawn as |
|---|---|---|---|
| `top` | above, nose up | LF RF / LR RR (car's left on the left) | footprints: tread width by diameter |
| `front` | in front, looking rearward | RF, LF (car's left on the right) | tire widths end on, never circles |
| `rear` | behind, looking forward | LR, RR (car's left on the left) | tire widths end on, never circles |
| `left-side` | the car's left, nose left | LF, LR | round sidewalls |
| `right-side` | the car's right, nose right | RR, RF | round sidewalls |

The right side is never the left side mirrored: a real car isn't symmetrical. Only the generic car, which is, builds
one from the other.

## Layers

1. **Background** (the host drawing): grid, ground line, reference axes.
2. **Vehicle** (`EngineeringCarView.tsx`): the drawing, in groups `data-layer="body|glass|details|lights|aero|wheels"`,
   styled by the theme through the classes `ecv-body`, `ecv-glass`, `ecv-panel`, `ecv-light`, `ecv-aero`, `ecv-tire`,
   `ecv-rim` (`globals.css`), so both themes work. A host hides a layer it draws itself (`showWheels={false}`,
   `showAero={false}`), so nothing is drawn twice.
3. **Engineering overlays** (the host): ride heights, toe, camber, brake shares, the wing per setup, placed by the
   view's anchors in the host's coordinates.
4. **Labels**: values, corner names, tooltips, the "Generic vehicle" / preview label and "Reference points
   approximate".

Changing the car changes layer 2 and where the anchors are; no measurement, unit or calculation changes.

## Anchors (`src/lib/carViews/anchors.ts`)

Each view's anchors are fractions (0-1) of its viewBox: `wheelCenters`, `contactPatches` and `rideHeightPoints` per
visible corner, `groundY` (every view but the top), `centerlineX`, and `splitter`, `diffuser`, `wing`. Each point has
`verified`: false unless a person checked it against the car. A part the view can't show, or nobody placed, is absent.

`checkViewAnchors` refuses anchors that break the view's conventions: a missing wheel, a corner the view can't show,
corners in the wrong screen order (a drawing mirrored by mistake is refused, never relabelled), a wheel below the
ground or a contact patch off it.

Hosts place a view with `placeView` (`EngineeringCarLayer`'s `fit`): in a box, standing on a ground line, or from above
with its axles at two heights; `PlacedCar` hands the overlays the anchors in host coordinates.

**Ride height**: iRacing doesn't say where it measures each car's ride height, so the generic car's reference points
are approximations, and the Suspension tab says so ("Reference points approximate"). The values and how they're drawn
(about the mean, exaggerated) are unchanged; only where along the car they're drawn comes from the drawing.

## Storage and review

- `"CarEngineeringAssets"` (`src/lib/carViews/carViewSchema.ts`): one row per version of a car's drawings, tied to
  Car Data's car (`car_id`, `ON DELETE CASCADE`) and to the iRacing car paths (`car_keys`, session info's CarPath,
  e.g. `lamborghinievogt3`) of the setups it's for, matched exactly, never by name. The sanitized markup, viewBox,
  anchors and `hasWheels` of each view are in `views` JSONB (small text, not object storage). `sources`, `license`,
  `notes` (approximations). One active version per car (a partial unique index); an active version must be approved.
- `"CarEngineeringAssetEvents"`: each version's review history.
- Workflow (`src/lib/carViews/assetRules.ts`): draft → under review → approved or rejected; an approved version with
  sources and a licence can be activated, which deactivates the car's other version (activating an older approved
  version is the rollback). A car path can belong to only one car's active drawings. Drafts and rejected versions can
  be deleted; approved ones stay.
- Admins only: the Admin page's Engineering Car Drawings (`src/components/CarViewAssetManager.tsx`),
  `GET`/`POST /api/admin/car-views`, `GET`/`PUT`/`DELETE /api/admin/car-views/[id]` (404 for anyone else). Each view is
  an SVG file and its anchors as JSON ("Start from the generic car's anchors" fills in a template); the preview shows
  every view with the debug marks on.
- Drivers: `GET /api/car-views?carKey=` (signed-in users) answers the car's active version or null. The browser loads
  each car once per page (`src/lib/carViews/carViewClient.ts`) and keeps the answer 5 minutes; the server keeps it a
  minute and empties it on every Admin change.

## Drawings in the repository

`data/car-drawings/` holds drawings made in the Lovable project `darinlutz/racingcoach-car-drawings` (each set's
`commit` in `BUNDLED_DRAWINGS`): the Lamborghini Huracán GT3 EVO and the Ferrari 296 GT3 (commit `a31b2ec`), and the
Chevrolet Corvette Z06 GT3.R and the Ford Mustang GT3 (commit `edea872`), five views each, orthographic line art from
Sketchfab models at 1 SVG unit = 1 mm, with their anchors and validation notes (the PNG renders aren't kept). All are
drafts, unverified against homologation drawings; the Corvette's and Mustang's wheelbases (2710 and 2720 mm) are
estimates their scale follows from. Read each folder's `VALIDATION-NOTES.md`.

- The Admin page's **Drawings in the repository** panel imports a set as a new draft version of the chosen Car Data
  car (suggested by name, accents and case aside; the car paths `lamborghinievogt3`, `ferrari296gt3`,
  `chevyvettez06rgt3` and `fordmustanggt3` are set from `BUNDLED_DRAWINGS`), through `validateDraft` like an upload. `GET`/`POST /api/admin/car-views/bundled`, Admins only.
  Drivers see nothing until the version is approved and activated
- `src/lib/carViews/lovableImport.ts` (pure) converts them: their `<g id="body">` and `<g id="wheels">` become the
  `body` and `wheels` layers, and their anchors (absolute mm, named by axle and side, aero parts as boxes) become ours
  (fractions per corner, parts at their boxes' centers), none verified. Their front and rear views' single centerline
  ride height reference isn't a corner's, so it's left out
- `src/lib/carViews/bundledDrawings.ts` reads them from disk (`process.cwd()/data/car-drawings`); the Dockerfile copies
  the folder beside the standalone server. A new set goes in the folder and in `BUNDLED_DRAWINGS`
- **Before activating** one: the Corvette's model is **CC BY-NC-SA 4.0**, non-commercial; its author granted
  RacingCoach.app permission to use it on the site on 2026-11-19, which `BUNDLED_DRAWINGS`' `permission` writes into the
  imported version's licence. CC BY 4.0 needs the model's author credited where drivers see it, which the drivers' pages
  don't show yet; and the Huracán's notes say its model may come from a racing-sim mod, so confirm the uploader could
  license it

## Security (`src/lib/carViews/svgSanitize.ts`)

An allowlist sanitizer runs on every upload and again on every read, and the page inlines only its output: the file is
tokenized, every element, attribute and value must be known, and the markup is written again from the tokens. Refused:
scripts, event handlers, `<style>`, `foreignObject`, images, filters, animation, links, text, nested `<svg>`,
DOCTYPEs, entities, CDATA, any reference that isn't to the drawing's own ids, and files over 400 KB, 8,000 elements or
48 levels deep. Inkscape's and Illustrator's metadata is dropped; a `style` attribute becomes the attributes it sets,
each checked. Ids are prefixed per copy on the page (`scopeIds`).

## Selected car

The engineering tabs compare two setups of one car, so the car is theirs: `SetupFocusComparison` and `SetupCompare`
give their baseline setup's car path to `CarViewProvider`, and every drawing under them shows that car. There's no
second car picker. A setup without a car path shows the generic car.

## Debug mode

Admins get an **SVG debug** switch at the end of the engineering system tabs (remembered in this browser,
`setups.drawingDebug`), and the Admin preview always has it on. Every drawing then shows its viewBox, ground line,
centerline, axles, each visible corner's wheel center, contact patch and ride height reference point (dashed when
unverified), the aero anchors, which drawing it is (approved vN, preview vN or generic) and how many of its anchors are
verified (`CarDebugOverlay` in `EngineeringCarView.tsx`).

## Adding a car

1. Find the car in Car Data and its iRacing car path (session info's `CarPath`; the setups' `car_key`).
2. Collect references of the exact variant and the right to use them; record them as the version's sources and licence.
3. Draw the views (any of the five; missing ones show the generic car) with the layer groups and classes above,
   transparent background, no text. Draw both sides separately.
4. Place the anchors (start from the generic template), marking only what was checked as verified.
5. Save the draft, preview it with the debug marks, submit, approve, activate. No redeploy.

## Limitations

- No car has active drawings yet: the Huracán and Ferrari sets are drafts to import and review (above); every other
  car shows the generic GT3-class car, whose dimensions are illustrative and whose anchors are all unverified.
- Lap Compare's car drawings (`GT3CarTopView`, `DashboardCarView`, `RideHeightDashboard`) still use their own generic
  cars. Laps from the collector carry the car path and could use this system; Garage 61 exports carry only a name, so
  they'd stay generic.
- The Suspension tab's 3D overview isn't one of the five views and stays schematic.
- Toe and camber wheels, brake shares and tire gauges are schematic overlays at the car's wheel anchors; their sizes
  aren't the car's.

## Tests

`npm run test:car-views`: views, anchors and placement, the sanitizer (what it keeps and refuses), the generic car's
tires per view and one wheel per corner, the review rules and fallback; then the store against a local Postgres when
`CAR_VIEWS_TEST_DATABASE_URL` is set (see `scripts/car-views-db.test.mjs`). `e2e/setups.spec.ts` checks the drawings
on the Alignment and Suspension tabs.
