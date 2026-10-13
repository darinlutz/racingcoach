# Rotation Model

Detects understeer and oversteer from telemetry alone: no track position, racing line, reference lap or
track-specific setup. It drives the `UNDERSTEER` / `OVERSTEER` label in the collector's overlay and Rotation
window, and the same calculations run on the website over uploaded laps for post-session analysis.

Version 1.0.0 is an explainable, physics-based estimator, not a trained model. Its thresholds are provisional
engineering values to tune against reviewed real laps. They are not validated detection limits, and no
threshold here is claimed to suit every car.

| | |
|---|---|
| Shared settings | `rotation-model/config.json` |
| Car calibrations | `rotation-model/calibrations.json` (empty until cars are calibrated, see Calibration) |
| Node / website | `src/lib/rotationModel.ts` (the model), `src/lib/rotationAnalysis.ts` (lap CSVs, events, summaries), `GET /api/collector/rotation?ids=…` |
| Collector (C#) | `collector/RacingCoach.Collector/RotationModel/*.cs` (the model, a step-for-step port), `RotationMonitor.cs` (runs it on live telemetry) |
| Tests | `npm run test:rotation` (`scripts/rotation-model.test.mjs`): scenarios, regression (`fixtures/golden.json`) and C#/Node parity (`collector/RotationModel.Replay`) |
| Calibration | `scripts/rotation-calibrate.mjs` |

## What it answers

Each sample gets a `RotationModelResult`:

- `state`: `UNKNOWN` (the model can't judge this sample), `NEUTRAL`, `UNDERSTEER` or `OVERSTEER`.
- `displayLabel`: `"UNDERSTEER"`, `"OVERSTEER"` or `""`. The overlay shows exactly this. `UNKNOWN` and
  `NEUTRAL` show nothing, and an invalid sample never shows a label.
- `understeerConfidence` / `oversteerConfidence` (0-1): how sure the model is. `confidence` is the one for the
  current state (`1 - max(both)` when neutral, 0 when unknown).
- `understeerSeverity` / `oversteerSeverity` (0-100): how big the deviation is. This is separate from confidence: a
  large-looking deviation on doubtful data can have low confidence.
- Diagnostics: `yawRateActual`, `yawRateExpected`, `yawRateKinematic`, `yawRateError`, `yawResponseRatio`,
  `forwardVelocityMps`, `lateralVelocityMps`, `sideslipAngleRadians` / `Degrees`, `sideslipRateDegreesPerSecond`,
  `frontWheelAngleRadians`, `frontAxleSlipDegrees`, `rearAxleSlipDegrees`, `latAccelResidual`, `cornerPhase`
  (`STRAIGHT`, `ENTRY`, `MID_CORNER`, `EXIT`), `oversteerType` (`ENTRY`, `MID_CORNER`, `POWER_ON`), `capability`
  (`FULL`, or `YAW_ONLY` without usable VelocityX/VelocityY), `invalidReason`, `modelVersion`,
  `calibrationId`, `isCalibrated`, `isValid`.

Events (`RotationModelEvent`): `eventType`, `startTime` (when the evidence first passed the enter threshold),
`confirmedTime` (when the label appeared), `endTime` (when the evidence first fell below the exit threshold),
`durationMs`, `peakSeverity`, `averageSeverity`, `peakConfidence`, `speedAtStartMps`, `cornerPhase`,
`oversteerType`, `phaseSamples`, `averageThrottle`, `averageBrake`, `lapDistPctStart` / `End` (metadata only:
the model never uses track position), `endReason` (`recovered`, `switched`, `invalid`, `reset`,
`end-of-data`), `modelVersion`, `calibrationId`.

## Telemetry and conventions

| iRacing variable | Unit | Required | Used for |
|---|---|---|---|
| `SessionTime` | s | yes | filters and derivatives use the real elapsed time |
| `Speed` | m/s | yes | speed gate, yaw reference |
| `SteeringWheelAngle` | rad | yes | steering demand |
| `YawRate` | rad/s | yes | actual rotation |
| `VelocityX`, `VelocityY` | m/s | no | sideslip. Without them the model runs `YAW_ONLY` |
| `LatAccel` | m/s² | no | grip-plateau evidence, consistency residual |
| `VertAccel` | m/s² | no | bump detection |
| `Throttle`, `Brake` | 0-1 | no | corner phase, oversteer subtype, entry allowance |
| `Yaw` | rad | only for `velocityFrame: "world"` | rotating world velocities into the car's frame |
| `LapDistPct`, `SessionNum`, `IsOnTrack` | | no | event position; resets |

Conventions (`config.json` → `conventions`):

- **Steering and yaw rate are positive to the left** (counterclockwise seen from above). The collector's Rotation
  window already shows them this way. `steeringSign` flips steering if the data disagree.
- **VelocityX/VelocityY are taken as the car's own frame** (`velocityFrame: "body"`): X forward, Y left, so
  `v_f = VelocityX`, `v_l = VelocityY`. Community tools and the collector's Rotation window treat them this way,
  but the SDK package ships no definition, and this hasn't been checked against recorded data yet. If they turn
  out to be world-frame, set `"world"`, and the model rotates them by `Yaw`
  (`v_f = Vx·cos ψ + Vy·sin ψ`, `v_l = −Vx·sin ψ + Vy·cos ψ`, with ψ counterclockwise). Two checks guard against a
  wrong frame:
  - per sample, `|√(Vx²+Vy²) − Speed|` must be within `velocityMagnitudeTolerance` (8%) of the speed;
  - over time, a slow score (time constant `frameCheckTau`, 20 s) tracks how often `|β| < 10°` above the minimum
    speed. Real cars spend nearly all their time well under 10° of sideslip, and a wrong frame would not. Below
    `frameCheckMinScore` (0.5), sideslip is switched off (`capability: YAW_ONLY`) instead of being trusted.
- **LatAccel's sign** is learned (`latAccelSign: "auto"`): the model accumulates `LatAccel · v·r` while cornering
  and fixes the sign once the evidence is clear. Until then the residual check is off. iRacing documents
  LatAccel as including gravity, so on banking it differs from `v·r`, and the residual limit is generous (8 m/s²).
- **Steering-wheel angle is not road-wheel angle.** `δ = θ_SW / R_s` only when a calibration gives the steering
  ratio `R_s`. Otherwise the reference uses identified products (below) and never pretends to know δ.

`scripts/rotation-calibrate.mjs` prints all of these checks for real laps (see Validation).

## Equations

All signals are first low-pass filtered over elapsed time, `y ← y + α(x − y)` with `α = 1 − e^(−Δt/τ)` (time
constants in `filters`). Derivatives are differences of filtered values, filtered again (`derivativeTau`).

1. **Vehicle-frame velocity and sideslip**: `β = atan2(v_l, v_f)`, unwrapped against the previous sample, and
   `β̇ = Δβ/Δt` (filtered). Only when the velocity is valid, the car isn't reversing (`v_f < −0.5 m/s`), the
   speed is ≥ `minSpeedMps` and the frame check passes. Sideslip is the angle between heading and travel. On its
   own it does not establish oversteer.
2. **Kinematic yaw rate** (diagnostic only, needs wheelbase L and R_s): `r_kin = v_f·tan(δ)/L`. This is a
   low-slip geometric reference and is never used to classify.
3. **Steady-state yaw reference** (bicycle model, small angles): `r_ref = v·δ / (L + K_u·v²)`. With
   `δ = θ/R_s` this is `r_ref = v·θ / (R_s·L + R_s·K_u·v²)`, so the reference needs only the two products
   `A = R_s·L` (m) and `B = R_s·K_u` (s²). Those can be identified from telemetry without knowing the
   wheelbase or steering ratio. Calibrations give either
   - `calibrated-bicycle`: physical `wheelbaseMeters`, `steeringRatio`, `understeerGradient` (K_u, s²/m);
   - `identified-bicycle`: `effectiveSteerLength` (A) and `effectiveUndersteerTerm` (B);
   - `yaw-gain-map`: measured yaw rate per radian of steering wheel at several speeds, linearly interpolated (a
     speed-dependent reference surface; steering linearity and longitudinal-acceleration dependence are future
     extensions).

   The reference is undefined outside `validSpeedRangeMps`, and where `A + B·v² < 0.25·A` (near the critical
   speed of an oversteering fit). The model is then `UNKNOWN` (`outside-calibrated-range`). The static
   reference goes through a first-order lag (`yawResponseTau`, 0.12 s) for the car's normal yaw response delay,
   so ordinary turn-in isn't read as a yaw deficit.
4. **Yaw error**: `e_r = r − r_ref`, `R_yaw = r / r_ref` when `|r_ref| ≥ minTurnYawRate`, and the
   turn-normalised forms
   - **deficit** `D = (|r_ref| − r·sign(r_ref)) / |r_ref|` (0 = as expected, 1 = no rotation at all). It is 0 when
     the car rotates against the steering demand (that is never understeer) or countersteer is detected;
   - **excess** `X = (r·d − r_ref·d) / max(|r_ref|, minTurnYawRate)`, where `d` is the turn direction (that of
     `r` once it's established).
5. **Lateral acceleration**: `a_y ≈ v̇_l + v_f·r`. The residual `e_a = a_y − (v̇_l + v_f·r)` only validates the
   data: above `maxLatAccelResidualMps2` the sample is `UNKNOWN`. `|a_y|` compared with its recent peak (a peak
   hold decaying with `latAccelPeakDecayTau`, 60 s, never below `latAccelPeakMinMps2`) indicates the grip
   plateau.
6. **Axle slip angles** (optional, needs R_s and the CG distances a, b):
   `α_f = δ − atan2(v_l + a·r, v_f)`, `α_r = −atan2(v_l − b·r, v_f)`. These are approximate single-track
   kinematics, not tire measurements. They only ever add supporting evidence, never classify alone.

## Evidence, confidence and severity

`ramp(x, a, b)` is 0 at `a`, 1 at `b`, linear between. Supporting signals combine as a noisy-OR,
`support = 1 − Π(1 − wᵢ·eᵢ)`: any one strong, reliable sign is enough, and a signal that's missing (no
velocity, no geometry) doesn't count against the others.

**Understeer**: a sustained lack of yaw response to steering.

```
core       = ramp(D, yawDeficitStart 0.12, yawDeficitFull 0.40)
support    = noisyOR( growth:   ramp(dD/dt, 0.3, 1.5 /s)          weight 0.8   (more steering, no more yaw)
                      plateau:  ramp(|a_y| / peak, 0.80, 0.95)      weight 1.0   (front at its grip limit)
                      frontAxle: ramp(|α_f| − |α_r|, 1°, 4°)        weight 0.5 ) (only with geometry)
steadiness = 1 − ramp(|θ̇|, 0.6, 3 rad/s)                                         (steering transients don't count)
confidence = core · (coreWeight 0.6 + 0.4 · support) · steadiness
severity   = 100 · ramp(D, 0.12, severityFull 0.6)
```

A yaw deficit alone reaches at most 0.6 confidence, below the 0.75 needed to show the label. It takes a growing
deficit or a lateral-acceleration plateau as well. The reference already contains the car's normal understeer
gradient (B), so a deficit is understeer beyond what the car normally does.

**Oversteer**: rotation beyond what the steering asks for.

```
countersteer = |r| ≥ minTurn, steering opposite to r by > 0.05 rad, and (sideslip outward ≥ 3°, or without
               sideslip: |r| still growing). A quick direction change has neither.
core       = countersteer ? 1 : ramp(X, yawExcessStart 0.12 + allowance, yawExcessFull 0.45 + allowance)
             allowance = entryAllowance 0.10 on the brakes (trail-braking rotation is normal)
support    = noisyOR( sideslip:     ramp(outward β, 3°, 8°)          weight 1.0
                      sideslipRate: ramp(outward β̇, 6, 25 °/s)       weight 0.8
                      countersteer: 0/1                               weight 1.0
                      rearAxle:     ramp(|α_r|, 3°, 7°)               weight 0.5 )
confidence = core · (0.6 + 0.4 · support)
severity   = 100 · max(ramp(X, 0.12 + allowance, severityYawFull 0.8 + allowance), ramp(outward β, 3°, 12°))
```

Outward sideslip means the rear stepping out: `−β·d`. In a left turn, β < 0. Yaw excess alone (no sideslip
growth, no countersteer) stays at 0.6. Without VelocityX/VelocityY (`YAW_ONLY`), oversteer needs countersteer
to be confirmed. That's deliberate, because old laps can't show sideslip.

**Subtypes**: `ENTRY` (braking), `POWER_ON` (throttle ≥ `throttleExit`), else `MID_CORNER`. **Corner phase**:
`STRAIGHT` when neither `|r|` nor `|r_ref|` reaches `minTurnYawRate`, then `ENTRY` / `EXIT` / `MID_CORNER` as above.

## When it says UNKNOWN

`invalidReason`: `missing-time`, `missing-telemetry` (Speed, SteeringWheelAngle or YawRate), `not-driving`
(`IsOnTrack` false or a replay), `warming-up` (0.3 s after any reset), `low-speed` (< 12 m/s), `reversing`,
`uncalibrated`, `outside-calibrated-range`, `disturbance` (|VertAccel − its 1 s baseline| > 6 m/s², held 0.15 s),
`inconsistent-lateral-acceleration`. The model resets (filters cleared, open event closed) when SessionTime goes
backwards or jumps more than 0.25 s (a pause or reconnect), SessionNum changes, required telemetry is missing,
the car leaves the track, or the calibration changes (a new car). A repeated SessionTime (sim paused) returns the
previous result unchanged.

## State machine

```
UNKNOWN ──valid sample──▶ NEUTRAL
NEUTRAL ──oversteer confidence ≥ 0.75 for 0.15 s──▶ OVERSTEER     (checked first)
NEUTRAL ──understeer confidence ≥ 0.75 for 0.15 s, oversteer < 0.45──▶ UNDERSTEER
UNDERSTEER/OVERSTEER ──its confidence < 0.45 for 0.25 s──▶ NEUTRAL
UNDERSTEER ⇄ OVERSTEER only after 0.3 s in the current state (minHoldSeconds), and the other one ready
any ──invalid sample──▶ UNKNOWN (an open event ends with endReason "invalid")
```

Separate enter/exit thresholds (hysteresis), dwell times and the minimum hold stop the label flickering or
flipping between the two.

## Configuration and calibration format

`config.json` holds every threshold above (names as in this document), plus `display.understeerColor`
(#F59E0B, amber) and `display.oversteerColor` (#EF4444, red) for the overlay. A calibration's `overrides` merge
into it for that car, e.g. `{ "understeer": { "yawDeficitStart": 0.15 } }`.

`calibrations.json` → `calibrations[]`:

```json
{
  "calibrationId": "porsche992rgt3-2026-10-20",
  "calibrationVersion": "1.0.0",
  "carId": "porsche992rgt3",
  "carNames": ["Porsche 911 GT3 R (992)"],
  "wheelbaseMeters": null,
  "steeringRatio": null,
  "cgToFrontAxleMeters": null,
  "cgToRearAxleMeters": null,
  "understeerGradient": null,
  "effectiveSteerLength": null,
  "effectiveUndersteerTerm": null,
  "yawReferenceModel": "identified-bicycle",
  "yawGainMap": null,
  "validSpeedRangeMps": null,
  "overrides": null,
  "source": "how it was made"
}
```

The values shown are placeholders. Unknown physical values stay `null`, and nothing is invented. Cars match on
`carId` (iRacing's `CarPath`) first, then on `carNames` (iRacing's `CarScreenName`, which is also what uploaded
laps record). On the sim PC, `Documents\RacingCoach\rotation-model\config.json` replaces the built-in settings
and `calibrations.json` there adds or replaces cars, so both can be tuned without a new collector. The website
only uses the files in this folder.

## Calibration

iRacing's telemetry and session info give neither the wheelbase nor the steering ratio. The Car Data tab has
wheelbases, but no steering ratios. Setups can change the ratio, and it may be nonlinear. So the procedure
identifies `A = R_s·L` and `B = R_s·K_u` straight from the car's own normal response:

1. Drive clean laps in the car: a mix of corner speeds, smooth inputs, no spins. With the new collector, laps
   also record VelocityX/VelocityY, which the convention check and sideslip need.
2. Run `node scripts/rotation-calibrate.mjs --car "<iRacing car name>" --db --car-id <CarPath>`. Alternatively,
   pass lap CSVs or the `Documents\RacingCoach\Laps\…` folders instead of `--db`. `--db` reads `DATABASE_URL`
   read-only.
3. The script keeps only steady, non-saturated cornering: no brakes, steering rate < 0.3 rad/s, yaw acceleration
   < 0.15 rad/s², |LongAccel| < 3 m/s², under half the car's 98th-percentile lateral acceleration, under 3°
   sideslip when known, no bumps. It then takes the median yaw rate per radian of steering wheel in 5 m/s speed
   bins (at least 1 s of data each), and fits `v/gain = A + B·v²` by weighted least squares. Spins, slides and
   the grip limit are never learned as normal.
4. Read its report: the convention checks, the per-bin fit, and how the calibrated model judges the same laps
   (share of samples judged, events per lap, the spread of normal yaw deficit and sideslip). Then rerun with
   `--write` to save the calibration. `--wheelbase <m>` (e.g. from Car Data) also reports the effective
   steering ratio it implies.
5. `npm run test:rotation`, commit, and release the collector (it builds `calibrations.json` in), or copy the
   calibration to the sim PC's `Documents\RacingCoach\rotation-model\calibrations.json` to try it first.

Recalibrate after big setup changes to steering ratio, ride height or aero, and per car (never assume one
car's numbers fit another). `yawResponseTau` and the thresholds are not fitted. Tune them as below.

## Tuning

- **False understeer on turn-in**: raise `yawResponseTau` (the car's yaw lag) or lower
  `steeringRateOkRadPerSec`.
- **Understeer only at the very limit, or too late**: lower `yawDeficitStart` / `latAccelPlateauStart`. Raise
  them if it shows during normal cornering.
- **Trail-braking shown as oversteer**: raise `entryAllowance`.
- **Oversteer too late**: lower `sideslipStartDeg` (start from the calibration report's p95 normal sideslip).
- **Flicker**: raise `enterSeconds` / `exitSeconds`, or widen the gap between `enterConfidence` and
  `exitConfidence`.
- **Per car**: put the change in that car's calibration `overrides`, not the global config.

After a change, run `npm run test:rotation`. If the scenarios still pass and the new behaviour is intended,
update the regression file with `ROTATION_UPDATE_GOLDEN=1 npm run test:rotation` and review its diff. Raise
`modelVersion` in `config.json` when the model's equations change (in both languages), and `configVersion`
when only thresholds do.

## C# / Node parity

There is one specification (this file), one settings file and one calibrations file. The Node model is the
reference, and the C# model is a step-for-step port with the same order of operations, so they compute the same
IEEE doubles except where `exp`/`atan2`/`tan` round differently in the last bit. The parity test runs every
fixture through both and requires:

- every numeric output within `1e-6 + 1e-6·|value|` (measured: under 3e-13);
- identical states, labels, phases and reasons, except within 2 samples of a state change, where a last-bit
  difference could move a threshold crossing (measured: 0 mismatches);
- the same events, with start and end times within 2 samples (1/30 s).

Change a calculation in `rotationModel.ts` and `RotationModel.cs` together, in the same order, and run the
test. It needs the .NET 10 SDK (`ROTATION_REQUIRE_DOTNET=1` makes a missing SDK fail instead of skip).

## Tests

`npm run test:rotation` runs synthetic, deterministic 60 Hz scenarios from `scripts/rotation-model-fixtures.mjs`
(a single-track test car whose numbers are test values, not a real car's): straight-line acceleration,
constant-radius neutral cornering, increasing steering with no extra yaw (left and right), excessive yaw (left
and right), progressive rear sideslip, countersteer, trail-braking rotation (must not trigger), power-on
oversteer, high-speed steady cornering, a low-speed hairpin, sensor noise, kerb strikes, missing velocity
(understeer still found; oversteer without countersteer correctly not confirmed), missing yaw rate, no
calibration, standstill, a pause and time gap, a session change, a quick left-right steering reversal (must not
trigger), a spin and recovery, and axle slip angles with known geometry. It also checks determinism, the
regression file, and C#/Node parity.

These scenarios prove the implementation does what this document says. They do not prove the model finds real
tire saturation. That needs real laps (below).

## Validation with real iRacing sessions

1. **Conventions**: run the calibration script on recent laps (with VelocityX/VelocityY) and check that it
   confirms steeringSign 1, a kinematic LatAccel, and the body velocity frame. In the car, the Rotation window
   should show Velocity X ≈ Speed and Velocity Y ≈ 0 on a straight in any compass direction, Velocity Y pointing
   right ("R") while the rear steps out in a left-hand corner (the car travels to the right of where its nose
   points), and Sideslip near 0 on straights.
2. **Calibrate** the car (above), then drive with the Rotation window open. On clean laps it should read about
   100% "Yaw Rate vs Expected" mid-corner and NEUTRAL, with no labels.
3. **Provoke and record**: in practice, deliberately push into understeer (turn in too fast, add lock), and
   provoke oversteer (lift or trail-brake hard into a fast corner, power out of slow ones), spin a few times, and
   drive some deliberately clean laps. Note the laps and corners, or use OBS/the replay with the overlay visible.
4. **Review**: `GET /api/collector/rotation?ids=<lap ids>` (signed in) lists each lap's events with times,
   positions (LapDistPct), severities and phases, plus places that recur lap after lap. Mark each event as a true
   or false detection against the replay, and list handling moments it missed.
5. **Report per car**: false positives per clean lap, missed events, detection latency (`confirmedTime` minus
   when it visibly started, about 0.15 s plus filter lag by design), and the event rates in the calibration
   report. Tune (above), recalibrate if needed, and repeat in at least one other car before trusting the
   thresholds across cars.

## Limitations

- **Calibration is required**: without one a car is always `UNKNOWN`. That's on purpose, since a universal GT3
  reference would mislabel every car whose steering ratio differs.
- **Small-angle, steady-state reference**: transients are handled by the lag and the steadiness factor, not
  modeled. Very low speeds (hairpins near 12 m/s) and very large steering angles are where the linear reference
  is weakest.
- **Longitudinal load transfer** is not in the reference yet: braking increases rotation, which is why entry
  oversteer gets an allowance rather than a model.
- **LatAccel includes gravity** on banking and camber, so the residual check is loose.
- **Axle slip angles** need CG positions that aren't known for any car yet, so those terms are usually absent.
- **Old laps** (before the collector saved VelocityX/VelocityY) are `YAW_ONLY`: understeer works, but oversteer
  needs countersteer. Garage 61 exports have no SessionTime and are unsupported rather than given invented
  timestamps.
- **Events aren't stored separately**: post-session analysis recomputes them from the uploaded CSVs, so the
  results always use the current model and calibration (`modelVersion` and `calibrationId` say which).
