# Capstone: brake-point predictor from your telemetry
# Train a model that predicts, for each TrackConfig area, where you brake (feet) and how hard (max Brake %), then compare its predictions to the hand-set targets in TrackConfig.js.


# 1. Collect data. Drive 20+ clean laps at one track you already have areas for (Lime Rock Classic is a good fit). Use the .ibt files iRacing writes when telemetry logging is on (Alt+L in the car); pyirsdk can read them (see its README for the IBT reader).


# 2. Extract channels into a tensor per lap: Speed, Brake, Throttle, LapDistPct, plus Lap to split laps. Drop out-laps and laps with incidents.


# 3. Build one row per lap per area:
# entry speed = Speed at the area's start LapDistPct
# brake point = first LapDistPct in the window where Brake > 0.05, converted to feet with TrackLengthInFeet
# max brake = Brake.max() inside the window
# throttle pickup = first sample after the apex where Throttle ≥ 0.75


# 4. Features and targets. Inputs: entry speed + one-hot area index (+ fuel if logged). Targets: brake point (ft), max brake (%), throttle pickup (ft). Normalize all of them.
# Train Thursday's MLP shape on it with Saturday's set_seed, holding out your 4 most recent laps as validation.
# Gradient-check the full loss once in float64 with your Friday checker.


# 5. Compare in a small table: TrackConfig target vs your median vs model prediction at your typical entry speed, per area. Big gaps are either a bad target or a coaching opportunity.
# Keep expectations honest: 20 laps is a tiny dataset, so the model will barely beat the per-area median. The point this week is a correct, reproducible pipeline you can scale once you have more drivers and laps.
