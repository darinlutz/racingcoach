# 3D car models

Each Car Data car can have a GLB 3D model, stored in the RacingCoach R2 bucket and approved by an Admin. Two places use
the same approved model, normalization and file:

- **Lap Compare → 3D view.** Each lap's own car is drawn moving along its driving line, posed from its telemetry.
- **Setups → Suspension → Interactive 3D.** The compared setups' car can be turned, zoomed, panned and inspected corner
  by corner.

A car without an approved model shows the generic GT3-class car, labelled "Generic vehicle". A car never gets another
car's model.

## Architecture

| Layer | Files |
| --- | --- |
| Coordinate convention and matrices (pure) | `src/lib/carModels/matrix.ts` |
| Upload check (pure) | `src/lib/carModels/glb.ts` |
| Review rules, settings, wheel centers (pure) | `src/lib/carModels/modelRules.ts` |
| Exact name → car path (pure) | `src/lib/carModels/carPathByName.ts` |
| Database | `src/lib/carModels/carModelStore.ts`, tables in `src/lib/carViews/carViewSchema.ts` |
| Object storage | `src/lib/carModels/carModelStorage.ts` |
| Routes | `GET /api/car-models`, `GET /api/car-models/[id]/file`, `/api/admin/car-models`, `/api/admin/car-models/[id]` |
| Asset resolver (browser) | `src/lib/carModels/carModelClient.ts` (`useCarModel`) |
| deck.gl loader (Lap Compare) | `src/lib/carModels/deckModel.ts` |
| three.js components | `src/components/car3d/`: `Car3DViewer` (canvas, lights, ground, OrbitControls, presets, corners), `GlbCar` inside it (the model), `GenericCar3D`, `threeModels.ts` (shared, reference-counted loading and disposal), `Car3DViewerLazy` (next/dynamic, `ssr: false`) |
| Admin | `src/components/CarModelAssetManager.tsx` (Admin page, beside Engineering Car Drawings) |

### One system, two renderers

Lap Compare's 3D view was already deck.gl: the road, the lines, the time-gap wall, the chase cameras and Play. Rewriting
it in three.js would have meant rebuilding all of that and syncing two WebGL contexts and cameras. So that scene keeps
deck.gl and draws the GLB with deck.gl's `ScenegraphLayer` (loaders.gl's GLTFLoader).

The Setups and Admin viewers are React Three Fiber and Drei. Both renderers share everything else:

- the asset record and the resolver (`useCarModel`);
- the file and its URL;
- the normalization matrix (`normalizationMatrix`);
- the wheel-center anchors.

A model is therefore placed identically in both. `scripts/car-models.test.mjs` checks the deck.gl pose matrix against
deck.gl's own `getOrientation` convention and the canonical → three.js conversion.

## The canonical frame

All coordinates are in **meters**. +X is the car's forward, +Y its left and +Z up. The origin is on the ground under
the middle of the car's plan view. This is the frame Lap Compare's generic car (`carModel3d.ts`) was already built in.

Each GLB gets a **normalization**: `{ up, forward, scale, yaw, offset }`.

- `up` and `forward` name the model's own axes that point up and forward. glTF is +Y up; most cars then face +Z or
  −Z, which the Admin picks in the preview.
- `scale` converts the model's units to meters.
- `yaw` (degrees) straightens a model that sits at an angle.
- `offset` (meters, canonical) moves the origin after the automatic placement.

`normalizationMatrix` applies these steps in order:

1. Rotates the model's axes to the canonical ones. This is a rotation only: a mirrored model stays mirrored, and the
   preview shows it.
2. Scales the model.
3. Centers its plan view and stands it on the ground (its lowest point at z = 0).
4. Applies the yaw, then the offset.

The model's bounds come from its own accessors at upload, so nothing loads the model to place it. Scale is never
inferred from the bounding box. The Admin preview shows the model's size beside Car Data's length, width and wheelbase,
and warns when the length differs by more than 5%.

three.js is +Y up: `CANONICAL_TO_THREE` maps (x, y, z) to (x, z, −y).

## Car identity

Models are tied to Car Data's car (`car_id`) and to the **exact iRacing car paths** (CarPath, e.g. `lamborghinievogt3`)
they're for. The Huracán GT3, GT3 EVO and EVO2 have different car paths and never share a model by accident. Only one
car's active model may claim a car path (`carKeyTaken`).

How each place finds its car:

- **Collector laps** carry the car path (`"CollectorLaps".car_key`, from collector 1.68.0 on). It's sent as
  `CollectorLapSummary.carKey`, then `LapFile.carKey`, then `PedalTraceLap.carKey`, for iRacing laps only.
- **Dropped Garage 61 files and the Target Lap** have only a name. `carPathForName` looks it up by an exact match in
  `IRACING_CARS`'s curated names, ignoring accents, case and punctuation, never a "contains" match. A name shared by two
  car paths resolves to nothing.
- **Setups** use the compared setups' car path (`useSelectedCarKey` from `CarViewProvider`).

The car path pattern is the drawings' `CAR_KEY`, which doesn't allow spaces. Car paths with spaces (e.g. some NASCAR
cars) can't have a model yet, as with the drawings.

## Workflow

The statuses are Missing (no version), Uploaded, Ready for Review, Approved and Rejected. Only an active, approved
version reaches drivers.

1. **Upload.** The Admin page's 3D Car Models panel takes a car, its car paths, the GLB, and its source, licence,
   author's credit and notes. `checkGlb` checks the file before anything is stored. The file is put in object storage
   at `car-models/{carId}/{sha256}.glb`, and its row is added as **Uploaded** with estimated, unverified wheel centers
   (from the model's size and Car Data's wheelbase).
2. **Set it up.** In the Preview, the Admin sets:
   - up and forward axes, scale, yaw and offset;
   - the wheel centers (each can be marked verified);
   - the opening camera;
   - the car paths and provenance.

   The preview shows the canonical axes (red forward, green left, blue up), the model's box and the wheel rings, and
   updates as the fields change. Save writes the settings.
3. **Submit** (→ Ready for Review), then **Approve** or **Reject**. Settings can only change while a version is
   Uploaded or Rejected. Editing a Rejected version returns it to Uploaded.
4. **Activate.** This needs an approved version with its source and licence recorded, and the author's credit for any
   CC BY licence. The credit is then shown under the model in Lap Compare and Setups. Activating replaces the car's
   active version. Activating an older approved version is the **rollback**.
5. **Replace.** Upload a new version and activate it. A version's bytes never change (content-addressed, with the hash
   in the URL), so browsers keep the file for a year with no stale cache.

Every action is logged in `"CarModelAssetEvents"`. Any version can be deleted with its Delete button, which removes its
file and lite copy too (and its events). Deleting the active version leaves the car with none, so drivers see the
generic car until another approved version is activated; a deleted approved version can't be rolled back to.

There is no "Processing" status. The check runs during the upload request, so no version is ever seen half-checked.

## Upload check (`glb.ts`)

The check refuses:

- anything that isn't binary glTF 2.0;
- a truncated or malformed chunk;
- any buffer or image that points outside the file (an http URL or another file), so a model can never make a browser
  fetch from elsewhere;
- Draco, meshopt or Basis compression, because they need decoders the site doesn't host: the loaders and the CSP would
  have to fetch them from a CDN. Export models uncompressed;
- unknown required extensions;
- files over **40 MB** or **1,500,000 triangles**.

It warns about more than 400,000 triangles (Lap Compare draws two models every frame), animations (never played),
skins, cameras and lights. The bounds are each mesh's POSITION accessor min/max, taken through the default scene's
node transforms.

## Delivery and security

- Files are stored in the existing RacingCoach R2 bucket (`objectStorage.ts`, `BROADCAST_VIDEO_S3_*`). No new bucket
  or credentials are needed.
- `GET /api/car-models/[id]/file` streams the file through the site after checking access:
  - any signed-in user gets an active, approved version;
  - an Admin gets any version;
  - everyone else gets 404.
- No storage URL or credential reaches a browser, so the bucket needs **no CORS rule** for models.
- Approved files are sent with `Cache-Control: private, max-age=31536000, immutable` and an ETag; previews with
  `no-store`.
- `GET /api/car-models?carKey=` (or `?carName=`) answers the active model or `null`, for signed-in users only. The
  browser keeps the answer 5 minutes and the server 1 minute (emptied by every Admin change).
- Uploads are read with `readFormDataLimited` (40 MB + 64 KB) and checked whole before storing.
- CSP: models are same-origin, and embedded textures become `blob:` images (already allowed). No decoder, WASM or HDR
  environment is loaded from anywhere, and drei's `Environment` presets (which fetch HDRs from a CDN) are not used.
  `npm run test:car-models` checks this.

## Lap Compare

`TrackLineMap3D` resolves each lap's car separately (`useCarModel`), so the two laps can be different cars. A car with
an approved model is drawn as a `ScenegraphLayer` with:

- `getPosition`: the same telemetry position as the generic car (`poseAt`);
- `getTransformMatrix`: `deckPoseMatrix(pitch, yaw)` × the model's normalization. That's the same pitch (from the
  road's slope) and heading (iRacing's Yaw, lined up with the positions) as the generic car. On the road, never
  floating or sunk: the normalized model stands at z = 0 and the pose's height is the road's.

The rest is as before:

- The Target lap's car is the ghost (opacity 140/255, no depth writes, drawn last).
- Only the model's shape is used: each car is drawn in its lap's color (Target blue, Compare red), whatever the
  model's livery. The page downloads a lighter copy (`/api/car-models/[id]/file?lite=1`, `glbLite.ts`): no textures,
  images, texture coordinates, vertex colors, tangents, skins, morph targets or animations, and no interior (seats,
  belts, dash, steering wheel, roll cage, nets, inner glass, by the names of the part's material, mesh and nodes,
  `INTERIOR_PART`; lights excepted, and nothing left out when over half the car is named so); each mesh welded and
  simplified with meshoptimizer to 45% of its triangles (150,000 for the whole car at most), within 0.6% of its size;
  then every part is moved into the scene's frame and merged by paint into one node and mesh with a primitive per
  paint (a few, where a model can have thousands, each of which deck.gl built and drew separately per car, freezing
  the page). It's made the first time it's asked for and kept beside the original (`car-models/{carId}/{sha256}.lite2.glb`,
  `carModelLite.ts`; an approved active version's only, and removed with a deleted version), so later viewers get it
  at once; a file it can't rewrite (sparse accessors) is sent as it is. Every material is painted grey
  (`modelPaint.ts`): white for the bodywork, so `getColor` gives it the lap's color in full, dark for tires, glass,
  carbon and black trim (by name, or a near-black color), glass keeping its transparency. The browser paints what it
  loads the same way and never decodes the model's images (`deckModel.ts`). Bump `LITE_VERSION` when the copy changes.
- The Cockpit view puts the camera in the Compare car's driver's seat and leaves that car out.
- Play, Reverse, Loop, the chase cameras and the crosshair are unchanged.
- The legend names each lap's car, or the generic car.
- The caption gives the authors' credits. When a lap's Yaw didn't match its positions, so its heading came from the
  line's direction, the caption says so for that lap.

The GLB is loaded once per URL for the page (`deckModel.ts`): two laps in the same car, the ghost, the solid car and
every focus area share one download and one parse. Each focus area's map is its own deck.gl canvas (as before), so
each holds its own GPU copy.

Front-wheel steering, wheel rotation and brake lights stay on the generic car only. A GLB's wheels are part of its body
mesh and aren't separately rigged.

## Setups → Suspension

The workstation has a **2D Engineering / Interactive 3D** switch, kept for the visit in `sessionStorage`
(`setups.suspensionDrawing`). Interactive 3D shows `Car3DViewer` for the compared setups' car:

- Drag to rotate (360° around; the camera stays above the ground). Scroll or pinch to zoom, and right-drag or two
  fingers to pan. Distance limits are 0.6–8× the car's size.
- Presets: Front ¾, Rear ¾, Front, Rear, Left side, Right side, Top, and Reset.
- **LF / RF / LR / RR** each pick a corner. The camera eases to that corner and its ring is highlighted in the
  baseline cyan (`--align-baseline`).
- The page's existing corner cards (current, reference and difference values) stay under the drawing and follow the
  selected corner both ways.

Corners are placed by the version's wheel-center **anchors**, never by mesh names. "Wheel positions approximate"
shows until all four are marked verified.

Models are exterior only. The tab says that the suspension isn't modelled and the corners are marked at the wheel
centers. Nothing animates travel, springs, ride height or rake: no model here is rigged and no data says how it would
move.

## Viewer behaviour

- One WebGL context per viewer, with `frameloop="demand"`: it renders only when the camera, model or settings change.
- Before mounting, the browser's WebGL support is checked. Without it, a message is shown instead of the canvas.
- A lost context shows a message with Try again, which mounts a new canvas.
- A model that fails to load falls back to the generic car with a note.
- `threeModels.ts` loads each GLB once per page and gives each viewer a clone. When the last viewer showing it
  unmounts, it disposes of the geometries, materials and textures.
- Text is in `setups.carModels` of the dictionaries (`carModelsText*.ts`, six languages).

## Database

The tables are created by `ensureUserSchema` through `CAR_VIEW_SCHEMA`. They are additive only.

- **`"CarModelAssets"`**:
  - identity: `car_id` (Cars, cascade), `version` (unique per car), `car_keys TEXT[]` (GIN index);
  - status: `status`, `active` (one active per car; active implies approved);
  - the file: `format` (`glb`), `storage_key` (unique), `file_name`, `bytes`, `sha256`, `raw_bounds`, `stats`,
    `warnings`;
  - the settings: `normalization`, `wheel_anchors`, `default_view`;
  - provenance: `source`, `license`, `attribution`, `notes`;
  - who and when: `created_by`, `reviewed_by`, `activated_by` (Users, set NULL), plus timestamps.
- **`"CarModelAssetEvents"`**: every upload, edit and action, with who made it.

Both are in the privacy inventory's `uploadsAsCoach`, like the drawings.

## Cloudflare and Render setup

Nothing new is required when the Broadcast Video Library's R2 bucket is already configured. Models use the same
`BROADCAST_VIDEO_S3_*` variables, under the `car-models/` prefix. No CORS rule is needed, since browsers never fetch
from the bucket directly.

For local development without R2, set `CAR_MODEL_DEV_STORAGE_DIR` to a folder on your computer. It's never used on
the live server.

## Adding the first model: the Lamborghini Huracán GT3 EVO

1. Get a GLB of the car whose licence allows use on a paid site. The Huracán drawings' source model is "Lamborghini
   Huracan GT3 EVO" by kevin (ケビン) on Sketchfab, CC BY 4.0. Its notes say it may come from a racing-sim mod, so
   confirm the uploader's right to license it. Download it as glTF Binary (.glb), without Draco compression; if it only
   comes compressed, open it in Blender and export it again with compression off.
2. On the Admin page's **3D Car Models**, pick the Car Data car "Lamborghini Huracán GT3 EVO" and enter the car path
   `lamborghinievogt3`. Choose the file and fill in Source (the Sketchfab link), Licence (`CC-BY-4.0`) and Author's
   credit (e.g. `"Lamborghini Huracan GT3 EVO" by kevin (ケビン), CC BY 4.0`). Then Upload.
3. In **Preview**:
   1. Set the Forward axis until the red arrow leaves through the nose (`+z` or `-z` for most Sketchfab exports).
   2. Check the model's length against Car Data's (about 4.55 m) and fix the scale if it's off.
   3. Use **Estimate from the model's size**, then move each wheel-center ring onto its wheel (the drawings' notes give
      a 2645 mm wheelbase and 1660/1619 mm tracks).
   4. Mark each wheel center verified, pick the opening camera, and **Save settings**.
4. **Submit for review**, **Approve**, then **Activate**.
5. Check it in Lap Compare's 3D view for a Huracán GT3 EVO lap, and in Setups → Suspension → Interactive 3D for a
   Huracán setup.

## Adding the other cars

Repeat for each car, with its own exact car paths (see `IRACING_CARS` in `src/lib/carPictures.ts`, the support page's
"Filepath for active iRacing cars", or the setups' and laps' `car_key`).

- The Cars list in the panel shows which cars have a model, filtered All / With a model / Missing.
- Keep models under about 400,000 triangles; decimate in Blender if needed.
- A licence marked NC (non-commercial) is flagged, as it may not allow a paid site: record the author's permission
  in the licence before activating, as was done for the Chevrolet Corvette Z06 GT3.R drawings' CC BY-NC-SA 4.0 source
  model (permission granted 2026-11-19).

## Tests

- `npm run test:car-models`:
  - pure: matrices, the upload check, the review rules, exact names, source guards;
  - database: with `CAR_MODELS_TEST_DATABASE_URL` and an in-memory object store.
- `e2e/car-models.spec.ts` (in `npm run test:e2e`): upload, review, activation and delivery, the Admin preview in
  WebGL, and the Suspension tab's Interactive 3D view (rotate, preset, corner, switch back to 2D).
- `node scripts/testCarGlb.mjs out.glb` writes the small test car, to try the upload locally.

## Future work

The architecture leaves room for:

- rigged suspension travel, ride height, rake, camber or steering, once a model has separate, verified parts and data
  says how they move;
- per-corner overlays (brake or tire temperatures) on the existing wheel anchors;
- clickable hotspots;
- side-by-side 3D setup comparisons.

None of these are implemented. A new capability should add verified anchors or component mappings to the version,
never guess from mesh names.
