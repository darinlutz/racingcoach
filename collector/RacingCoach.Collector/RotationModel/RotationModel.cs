using static RacingCoach.Collector.Rotation.RotationModelFilters;

namespace RacingCoach.Collector.Rotation;

/// <summary>
/// The Rotation Model: understeer and oversteer from live telemetry, without track position, racing lines or
/// reference laps. A port of src/lib/rotationModel.ts, step for step and in the same order of operations, so
/// both give the same results for the same samples (scripts/rotation-model.test.mjs checks it); change both
/// together. The math is in rotation-model/README.md.
/// Not thread-safe: call Update from one thread (the telemetry handler). It doesn't allocate per sample.
/// </summary>
internal sealed class RotationModel
{
    private const double Pi = Math.PI;

    private enum ReferenceKind { None, Bicycle, Map }

    private readonly RotationModelConfig _baseConfig;
    private RotationModelConfig _config;
    private RotationModelCalibration? _calibration;

    // The yaw reference, resolved once per calibration
    private ReferenceKind _kind;
    private double _a, _b; // Rs·L, Rs·Ku
    private YawGainPoint[] _map = [];
    private double _minSpeed, _maxSpeed;
    private double? _wheelbase, _ratio, _cgFront, _cgRear;

    // Time and filters (null = not started)
    private double? _prevTime;
    private int? _prevSessionNum;
    private double _warm;
    private double? _speedF, _steerF, _yawRateF, _vxF, _vyF, _latAccelF;
    private double? _prevBeta, _betaRateF, _prevVl, _vlDotF;
    private double? _prevSteer, _steerRateF, _prevYawRate, _yawAccelF, _refF, _prevDeficit, _deficitRateF;
    private double? _vertBase;
    private double _bumpTimer;

    // Slow statistics, kept through resets (cleared by SetCalibration)
    private double _frameScore = 1;
    private double _latSignEvidence;
    private double _latAccelPeak;

    // State machine
    private RotationState _state = RotationState.Unknown;
    private double _stateSince;
    private double _usEnterTimer, _osEnterTimer;
    private double _usCandidateStart, _osCandidateStart;
    private double _usCandidateSpeed, _osCandidateSpeed;
    private CornerPhase _usCandidatePhase, _osCandidatePhase;
    private double? _usCandidatePct, _osCandidatePct;
    private double _exitTimer, _exitStart;
    private OpenEvent? _open;
    private List<RotationModelEvent> _events = [];
    private RotationModelResult? _last;

    private sealed class OpenEvent
    {
        public RotationState Type;
        public double StartTime, ConfirmedTime, SpeedAtStart, LastTime;
        public CornerPhase Phase;
        public OversteerType? OversteerType;
        public double? LapDistPctStart, LapDistPctEnd;
        public int Samples;
        public double SeveritySum, PeakSeverity, PeakConfidence, ThrottleSum, BrakeSum;
        public readonly int[] PhaseSamples = new int[4]; // by CornerPhase
    }

    public RotationModel(RotationModelConfig config, RotationModelCalibration? calibration = null)
    {
        _baseConfig = config;
        _config = config;
        SetCalibration(calibration);
    }

    public RotationModelConfig Config => _config;
    public string? CalibrationId => _calibration?.CalibrationId;
    public bool HasEvents => _events.Count > 0;

    /// <summary>A new car (or none): its overrides and yaw reference, and a fresh start.</summary>
    public void SetCalibration(RotationModelCalibration? calibration)
    {
        _calibration = calibration;
        _config = _baseConfig.WithOverrides(calibration?.Overrides);
        ResolveReference(calibration);
        Reset(_prevTime, "reset");
        _frameScore = 1;
        _latSignEvidence = 0;
        _latAccelPeak = 0;
    }

    /// <summary>Events completed since the last call.</summary>
    public List<RotationModelEvent> TakeEvents()
    {
        var events = _events;
        _events = [];
        return events;
    }

    /// <summary>Ends an event still in progress (end of a stored lap or session).</summary>
    public void Finish()
    {
        if (_open is not null)
            CloseEvent(_open.LastTime, "end-of-data");
        _state = RotationState.Unknown;
    }

    private void ResolveReference(RotationModelCalibration? cal)
    {
        _kind = ReferenceKind.None;
        _a = _b = 0;
        _map = [];
        _minSpeed = _maxSpeed = 0;
        _wheelbase = _ratio = _cgFront = _cgRear = null;
        if (cal is null)
            return;
        double? Positive(double? x) => Ok(x) && x > 0 ? x : null;
        var wheelbase = Positive(cal.WheelbaseMeters);
        var ratio = Positive(cal.SteeringRatio);
        var cgFront = Positive(cal.CgToFrontAxleMeters);
        var cgRear = Positive(cal.CgToRearAxleMeters);
        var range = cal.ValidSpeedRangeMps;
        var minSpeed = range is { Length: > 0 } && double.IsFinite(range[0]) ? range[0] : 0;
        var maxSpeed = range is { Length: > 1 } && double.IsFinite(range[1]) ? range[1] : double.MaxValue;

        var kind = ReferenceKind.None;
        double a = 0, b = 0;
        YawGainPoint[] map = [];
        if (cal.YawReferenceModel == "yaw-gain-map")
        {
            map = (cal.YawGainMap ?? [])
                .Where(p => double.IsFinite(p.SpeedMps) && double.IsFinite(p.GainPerRad) && p.GainPerRad > 0)
                .OrderBy(p => p.SpeedMps)
                .ToArray();
            if (map.Length < 2)
                return;
            kind = ReferenceKind.Map;
            minSpeed = Math.Max(minSpeed, map[0].SpeedMps);
            maxSpeed = Math.Min(maxSpeed, map[^1].SpeedMps);
        }
        else if (cal.YawReferenceModel == "calibrated-bicycle")
        {
            if (wheelbase is null || ratio is null || !Ok(cal.UndersteerGradient))
                return;
            kind = ReferenceKind.Bicycle;
            a = ratio.Value * wheelbase.Value;
            b = ratio.Value * cal.UndersteerGradient!.Value;
        }
        else if (cal.YawReferenceModel == "identified-bicycle")
        {
            if (!Ok(cal.EffectiveSteerLength) || cal.EffectiveSteerLength <= 0 || !Ok(cal.EffectiveUndersteerTerm))
                return;
            kind = ReferenceKind.Bicycle;
            a = cal.EffectiveSteerLength!.Value;
            b = cal.EffectiveUndersteerTerm!.Value;
        }
        else
            return;

        (_kind, _a, _b, _map, _minSpeed, _maxSpeed) = (kind, a, b, map, minSpeed, maxSpeed);
        (_wheelbase, _ratio, _cgFront, _cgRear) = (wheelbase, ratio, cgFront, cgRear);
    }

    // Steady-state yaw rate the car should have at this speed and steering wheel angle, or null outside the
    // calibration's range
    private double? ReferenceYawRate(double speed, double steer)
    {
        if (_kind == ReferenceKind.None || speed < _minSpeed || speed > _maxSpeed)
            return null;
        if (_kind == ReferenceKind.Map)
        {
            var i = 0;
            while (i < _map.Length - 2 && speed > _map[i + 1].SpeedMps)
                i++;
            var p = _map[i];
            var q = _map[i + 1];
            var f = (speed - p.SpeedMps) / (q.SpeedMps - p.SpeedMps);
            return (p.GainPerRad + f * (q.GainPerRad - p.GainPerRad)) * steer;
        }
        var denominator = _a + _b * speed * speed;
        if (denominator < 0.25 * _a)
            return null; // past the critical speed of an oversteering fit
        return speed * steer / denominator;
    }

    private void Reset(double? time, string reason)
    {
        if (_open is not null)
            CloseEvent(_open.LastTime, reason);
        _prevTime = time;
        _prevSessionNum = null;
        _warm = 0;
        _speedF = _steerF = _yawRateF = _vxF = _vyF = _latAccelF = null;
        _prevBeta = _betaRateF = _prevVl = _vlDotF = null;
        _prevSteer = _steerRateF = _prevYawRate = _yawAccelF = _refF = _prevDeficit = _deficitRateF = null;
        _vertBase = null;
        _bumpTimer = 0;
        _state = RotationState.Unknown;
        _stateSince = time ?? 0;
        _usEnterTimer = _osEnterTimer = _exitTimer = 0;
    }

    public RotationModelResult Update(in RotationSample s)
    {
        var cfg = _config;
        if (!Ok(s.Time))
        {
            Reset(_prevTime, "reset");
            return Unknown(null, "missing-time");
        }
        var t = s.Time!.Value;

        double dt = 0;
        if (_prevTime is { } prevTime && _speedF is not null)
        {
            dt = t - prevTime;
            if (Math.Abs(dt) < 1e-9 && _last is { } last)
                return last; // paused, or the same sample again
            if (dt < 0)
            {
                Reset(t, "reset");
                dt = 0;
            }
            else if (dt > cfg.Validity.MaxSampleGapSeconds)
            {
                Reset(t, "reset");
                dt = 0;
            }
        }
        if (s.SessionNum is { } sessionNum && _prevSessionNum is { } prevSession && sessionNum != prevSession)
        {
            Reset(t, "reset");
            dt = 0;
        }
        if (s.IsOnTrack == false)
        {
            Reset(t, "reset");
            return Unknown(t, "not-driving");
        }
        if (!Ok(s.Speed) || !Ok(s.SteeringWheelAngle) || !Ok(s.YawRate))
        {
            Reset(t, "reset");
            return Unknown(t, "missing-telemetry");
        }
        _prevTime = t;
        if (s.SessionNum is { } num)
            _prevSessionNum = num;
        var first = _speedF is null;
        _warm = first ? 0 : _warm + dt;

        // 1. Filtered signals
        var f = cfg.Filters;
        var v = (_speedF = LowPass(_speedF, s.Speed!.Value, dt, f.SpeedTau)).Value;
        var steer = (_steerF = LowPass(_steerF, s.SteeringWheelAngle!.Value * cfg.Conventions.SteeringSign, dt, f.SteeringTau)).Value;
        var r = (_yawRateF = LowPass(_yawRateF, s.YawRate!.Value, dt, f.YawRateTau)).Value;
        var steerRate = (_steerRateF = _prevSteer is null || dt <= 0 ? 0 : LowPass(_steerRateF, (steer - _prevSteer.Value) / dt, dt, f.DerivativeTau)).Value;
        _prevSteer = steer;
        var yawAccel = (_yawAccelF = _prevYawRate is null || dt <= 0 ? 0 : LowPass(_yawAccelF, (r - _prevYawRate.Value) / dt, dt, f.DerivativeTau)).Value;
        _prevYawRate = r;
        var val = cfg.Validity;

        // 2. Vehicle-frame velocity and sideslip
        double? vf = null, vl = null, beta = null, betaRate = null, vlDot = null;
        var reversing = false;
        var sideslipValid = false;
        var world = cfg.Conventions.VelocityFrame == "world";
        if (Ok(s.VelocityX) && Ok(s.VelocityY) && (!world || Ok(s.Yaw)))
        {
            var vx = (_vxF = LowPass(_vxF, s.VelocityX!.Value, dt, f.VelocityTau)).Value;
            var vy = (_vyF = LowPass(_vyF, s.VelocityY!.Value, dt, f.VelocityTau)).Value;
            double forward, lateral;
            if (world)
            {
                var yaw = s.Yaw!.Value;
                forward = vx * Math.Cos(yaw) + vy * Math.Sin(yaw);
                lateral = -vx * Math.Sin(yaw) + vy * Math.Cos(yaw);
            }
            else
            {
                forward = vx;
                lateral = vy;
            }
            vf = forward;
            vl = lateral;
            var magnitudeOk = Math.Abs(Math.Sqrt(vx * vx + vy * vy) - v) <= val.VelocityMagnitudeTolerance * Math.Max(v, 5);
            reversing = forward < val.ReverseForwardVelocityMps;
            var b = Math.Atan2(lateral, forward);
            if (_prevBeta is { } prevBeta)
            {
                while (b - prevBeta > Pi)
                    b -= 2 * Pi;
                while (b - prevBeta < -Pi)
                    b += 2 * Pi;
            }
            beta = b;
            betaRate = _betaRateF = _prevBeta is null || dt <= 0 ? 0 : LowPass(_betaRateF, (b - _prevBeta.Value) / dt, dt, f.DerivativeTau);
            _prevBeta = b;
            vlDot = _vlDotF = _prevVl is null || dt <= 0 ? 0 : LowPass(_vlDotF, (lateral - _prevVl.Value) / dt, dt, f.DerivativeTau);
            _prevVl = lateral;
            if (v >= val.MinSpeedMps && dt > 0)
                _frameScore = LowPass(_frameScore, Math.Abs(b) * RadToDeg < val.FrameCheckMaxSideslipDeg ? 1 : 0, dt, val.FrameCheckTau);
            sideslipValid = magnitudeOk && !reversing && _frameScore >= val.FrameCheckMinScore && v >= val.MinSpeedMps;
        }
        else
        {
            _vxF = _vyF = _prevBeta = _betaRateF = _prevVl = _vlDotF = null;
        }
        var vRef = sideslipValid ? vf!.Value : v;

        // 3. Steering and the yaw reference
        double? delta = _ratio is { } ratio ? steer / ratio : null;
        double? rKin = delta is { } d && _wheelbase is { } wheelbase ? vRef * Math.Tan(d) / wheelbase : null;
        var rStatic = ReferenceYawRate(vRef, steer);
        var rRef = _refF = rStatic is { } staticRef ? LowPass(_refF, staticRef, dt, f.YawResponseTau) : null;

        // 4. Lateral acceleration: magnitude, its recent peak, and the kinematic residual
        double? ay = null;
        if (Ok(s.LatAccel))
        {
            ay = _latAccelF = LowPass(_latAccelF, s.LatAccel!.Value, dt, f.LatAccelTau);
            var kinematic = vRef * r;
            if (Math.Abs(kinematic) >= val.LatAccelSignMinLateralMps2)
                _latSignEvidence += ay.Value * kinematic * dt;
        }
        else
        {
            _latAccelF = null;
        }
        var ayMagnitude = ay is { } ayValue ? Math.Abs(ayValue) : Math.Abs(vRef * r);
        _latAccelPeak = Math.Max(ayMagnitude, _latAccelPeak * Math.Exp(-dt / cfg.Understeer.LatAccelPeakDecayTau));
        var latSign = cfg.Conventions.LatAccelSignAuto
            ? Math.Abs(_latSignEvidence) >= val.LatAccelSignMinEvidence ? Sign(_latSignEvidence) : 0
            : Sign(cfg.Conventions.LatAccelSignValue);
        double? residual = ay is { } ayNow && latSign != 0 && sideslipValid ? latSign * ayNow - (vlDot!.Value + vRef * r) : null;

        // 5. Bumps
        if (Ok(s.VertAccel))
        {
            var vert = s.VertAccel!.Value;
            var vertBase = (_vertBase = LowPass(_vertBase, vert, dt, f.VertBaselineTau)).Value;
            if (Math.Abs(vert - vertBase) > val.BumpVertAccelMps2)
                _bumpTimer = val.BumpHoldSeconds;
            else
                _bumpTimer = Math.Max(0, _bumpTimer - dt);
        }

        // 6. Axle slip angles (only with the car's geometry and steering ratio)
        double? alphaF = null, alphaR = null;
        if (sideslipValid && delta is { } wheelAngle && _cgFront is { } cgFront && _cgRear is { } cgRear)
        {
            alphaF = (wheelAngle - Math.Atan2(vl!.Value + cgFront * r, vRef)) * RadToDeg;
            alphaR = -Math.Atan2(vl!.Value - cgRear * r, vRef) * RadToDeg;
        }

        // 7. Can the model judge this sample?
        string? reason = null;
        if (_warm < val.WarmupSeconds) reason = "warming-up";
        else if (v < val.MinSpeedMps) reason = "low-speed";
        else if (reversing) reason = "reversing";
        else if (_kind == ReferenceKind.None) reason = "uncalibrated";
        else if (rRef is null) reason = "outside-calibrated-range";
        else if (_bumpTimer > 0) reason = "disturbance";
        else if (residual is { } res && Math.Abs(res) > val.MaxLatAccelResidualMps2) reason = "inconsistent-lateral-acceleration";
        var valid = reason is null;

        // 8. Evidence
        var throttle = Ok(s.Throttle) ? s.Throttle!.Value : 0;
        var brake = Ok(s.Brake) ? s.Brake!.Value : 0;
        var us = cfg.Understeer;
        var os = cfg.Oversteer;
        var minTurn = val.MinTurnYawRate;
        var refValue = rRef ?? 0;
        var absRef = Math.Abs(refValue);
        var absR = Math.Abs(r);
        var turn = Math.Max(absRef, absR) >= minTurn;
        var turnDir = absR >= minTurn ? Sign(r) : Sign(refValue);
        // Rotating against the driver's steering demand, however slowly: never understeer
        var opposite = r * Sign(refValue) < 0;
        double? slipOut = sideslipValid ? -beta!.Value * RadToDeg * turnDir : null;
        double? slipOutRate = sideslipValid ? -betaRate!.Value * RadToDeg * turnDir : null;
        // Opposite lock while the car keeps rotating: the rear is out (sideslip), or without sideslip, the
        // rotation is still building
        var countersteer = absR >= minTurn
            && steer * Sign(r) < -os.CountersteerMinRad
            && (slipOut is { } so ? so >= os.SideslipStartDeg : yawAccel * Sign(r) >= 0);
        var phase = !turn ? CornerPhase.Straight
            : brake >= cfg.Phase.BrakeOn ? CornerPhase.Entry
            : throttle >= cfg.Phase.ThrottleExit ? CornerPhase.Exit
            : CornerPhase.MidCorner;

        var deficit = absRef >= minTurn && !opposite && !countersteer ? (absRef - r * Sign(refValue)) / absRef : 0;
        var deficitRate = (_deficitRateF = _prevDeficit is null || dt <= 0 ? 0 : LowPass(_deficitRateF, (deficit - _prevDeficit.Value) / dt, dt, f.DerivativeTau)).Value;
        _prevDeficit = deficit;
        var rr = refValue * turnDir;
        var excess = turn ? (r * turnDir - rr) / Math.Max(Math.Abs(rr), minTurn) : 0;
        var allowance = phase == CornerPhase.Entry ? os.EntryAllowance : 0;

        var usCore = Ramp(deficit, us.YawDeficitStart, us.YawDeficitFull);
        var usNone = 1.0;
        usNone = NoneOf(usNone, Ramp(deficitRate, us.GrowthStartPerSecond, us.GrowthFullPerSecond), us.Weights.Growth);
        usNone = NoneOf(usNone, Ramp(ayMagnitude / Math.Max(_latAccelPeak, us.LatAccelPeakMinMps2), us.LatAccelPlateauStart, us.LatAccelPlateauFull), us.Weights.Plateau);
        usNone = NoneOf(usNone, alphaF is { } af && alphaR is { } ar ? Ramp(Math.Abs(af) - Math.Abs(ar), us.FrontSlipExcessStartDeg, us.FrontSlipExcessFullDeg) : null, us.Weights.FrontAxle);
        var usSupport = 1 - usNone;
        var steadiness = 1 - Ramp(Math.Abs(steerRate), us.SteeringRateOkRadPerSec, us.SteeringRateMaxRadPerSec);
        var usConfidence = usCore * (us.CoreWeight + (1 - us.CoreWeight) * usSupport) * steadiness;

        var osCore = countersteer ? 1 : Ramp(excess, os.YawExcessStart + allowance, os.YawExcessFull + allowance);
        var osNone = 1.0;
        osNone = NoneOf(osNone, slipOut is { } s1 ? Ramp(s1, os.SideslipStartDeg, os.SideslipFullDeg) : null, os.Weights.Sideslip);
        osNone = NoneOf(osNone, slipOutRate is { } s2 ? Ramp(s2, os.SideslipRateStartDegPerSec, os.SideslipRateFullDegPerSec) : null, os.Weights.SideslipRate);
        osNone = NoneOf(osNone, countersteer ? 1 : 0, os.Weights.Countersteer);
        osNone = NoneOf(osNone, alphaR is { } rear ? Ramp(Math.Abs(rear), os.RearSlipStartDeg, os.RearSlipFullDeg) : null, os.Weights.RearAxle);
        var osSupport = 1 - osNone;
        var osConfidence = osCore * (os.CoreWeight + (1 - os.CoreWeight) * osSupport);

        var usSeverity = 100 * Ramp(deficit, us.YawDeficitStart, us.SeverityFull);
        var osSeverity = 100 * Math.Max(
            countersteer ? 1 : Ramp(excess, os.YawExcessStart + allowance, os.SeverityYawFull + allowance),
            slipOut is { } s3 ? Ramp(s3, os.SideslipStartDeg, os.SeveritySideslipFullDeg) : 0);
        if (!valid || !turn)
            usConfidence = osConfidence = usSeverity = osSeverity = 0;

        // 9. State machine
        if (!valid)
        {
            if (_state != RotationState.Unknown)
            {
                if (_open is not null)
                    CloseEvent(t, "invalid");
                _state = RotationState.Unknown;
                _stateSince = t;
            }
            _usEnterTimer = _osEnterTimer = _exitTimer = 0;
        }
        else
        {
            var st = cfg.State;
            double? pct = Ok(s.LapDistPct) ? s.LapDistPct : null;
            if (usConfidence >= st.EnterConfidence)
            {
                if (_usEnterTimer == 0)
                    (_usCandidateStart, _usCandidateSpeed, _usCandidatePhase, _usCandidatePct) = (t, v, phase, pct);
                _usEnterTimer += dt > 0 ? dt : 1e-9;
            }
            else _usEnterTimer = 0;
            if (osConfidence >= st.EnterConfidence)
            {
                if (_osEnterTimer == 0)
                    (_osCandidateStart, _osCandidateSpeed, _osCandidatePhase, _osCandidatePct) = (t, v, phase, pct);
                _osEnterTimer += dt > 0 ? dt : 1e-9;
            }
            else _osEnterTimer = 0;

            var held = t - _stateSince;
            var osReady = _osEnterTimer >= st.EnterSeconds;
            var usReady = _usEnterTimer >= st.EnterSeconds && osConfidence < st.ExitConfidence;
            if (_state is RotationState.Understeer or RotationState.Oversteer)
            {
                var confidence = _state == RotationState.Understeer ? usConfidence : osConfidence;
                if (_state == RotationState.Understeer && osReady && held >= st.MinHoldSeconds)
                {
                    CloseEvent(t, "switched");
                    Enter(RotationState.Oversteer, t);
                }
                else if (_state == RotationState.Oversteer && usReady && osConfidence < st.ExitConfidence && held >= st.MinHoldSeconds)
                {
                    CloseEvent(t, "switched");
                    Enter(RotationState.Understeer, t);
                }
                else if (confidence < st.ExitConfidence)
                {
                    if (_exitTimer == 0)
                        _exitStart = t;
                    _exitTimer += dt > 0 ? dt : 1e-9;
                    if (_exitTimer >= st.ExitSeconds)
                    {
                        CloseEvent(_exitStart, "recovered");
                        _state = RotationState.Neutral;
                        _stateSince = t;
                    }
                }
                else _exitTimer = 0;
            }
            else if (osReady) Enter(RotationState.Oversteer, t);
            else if (usReady) Enter(RotationState.Understeer, t);
            else if (_state == RotationState.Unknown)
            {
                _state = RotationState.Neutral;
                _stateSince = t;
            }
        }

        OversteerType? oversteerType = _state != RotationState.Oversteer ? null
            : phase == CornerPhase.Entry ? OversteerType.Entry
            : phase == CornerPhase.Exit ? OversteerType.PowerOn
            : OversteerType.MidCorner;
        if (_open is { } e)
        {
            var severity = e.Type == RotationState.Understeer ? usSeverity : osSeverity;
            var confidence = e.Type == RotationState.Understeer ? usConfidence : osConfidence;
            e.Samples++;
            e.SeveritySum += severity;
            e.PeakSeverity = Math.Max(e.PeakSeverity, severity);
            e.PeakConfidence = Math.Max(e.PeakConfidence, confidence);
            e.ThrottleSum += throttle;
            e.BrakeSum += brake;
            e.PhaseSamples[(int)phase]++;
            e.LastTime = t;
            if (Ok(s.LapDistPct))
                e.LapDistPctEnd = s.LapDistPct;
        }

        var state = _state;
        var result = new RotationModelResult
        {
            Timestamp = t,
            State = state,
            DisplayLabel = state == RotationState.Understeer ? "UNDERSTEER" : state == RotationState.Oversteer ? "OVERSTEER" : "",
            Confidence = state == RotationState.Understeer ? usConfidence
                : state == RotationState.Oversteer ? osConfidence
                : state == RotationState.Neutral ? 1 - Math.Max(usConfidence, osConfidence)
                : 0,
            UndersteerConfidence = usConfidence,
            OversteerConfidence = osConfidence,
            UndersteerSeverity = usSeverity,
            OversteerSeverity = osSeverity,
            YawRateActual = r,
            YawRateExpected = rRef,
            YawRateKinematic = rKin,
            YawRateError = rRef is { } expected ? r - expected : null,
            YawResponseRatio = rRef is { } expectedRef && absRef >= minTurn ? r / expectedRef : null,
            ForwardVelocityMps = vf,
            LateralVelocityMps = vl,
            SideslipAngleRadians = beta,
            SideslipAngleDegrees = beta * RadToDeg,
            SideslipRateDegreesPerSecond = betaRate * RadToDeg,
            FrontWheelAngleRadians = delta,
            FrontAxleSlipDegrees = alphaF,
            RearAxleSlipDegrees = alphaR,
            LatAccelResidual = residual,
            CornerPhase = phase,
            OversteerType = oversteerType,
            FullCapability = sideslipValid,
            InvalidReason = reason,
            ModelVersion = cfg.ModelVersion,
            CalibrationId = CalibrationId,
            IsCalibrated = _kind != ReferenceKind.None,
            IsValid = valid,
        };
        _last = result;
        return result;
    }

    private void Enter(RotationState state, double t)
    {
        var us = state == RotationState.Understeer;
        _state = state;
        _stateSince = t;
        _exitTimer = 0;
        var phase = us ? _usCandidatePhase : _osCandidatePhase;
        var pct = us ? _usCandidatePct : _osCandidatePct;
        _open = new OpenEvent
        {
            Type = state,
            StartTime = us ? _usCandidateStart : _osCandidateStart,
            ConfirmedTime = t,
            SpeedAtStart = us ? _usCandidateSpeed : _osCandidateSpeed,
            Phase = phase,
            OversteerType = us ? null : phase == CornerPhase.Entry ? Rotation.OversteerType.Entry
                : phase == CornerPhase.Exit ? Rotation.OversteerType.PowerOn
                : Rotation.OversteerType.MidCorner,
            LapDistPctStart = pct,
            LapDistPctEnd = pct,
            LastTime = t,
        };
    }

    private void CloseEvent(double endTime, string endReason)
    {
        if (_open is not { } e)
            return;
        _open = null;
        var n = Math.Max(e.Samples, 1);
        _events.Add(new RotationModelEvent(
            e.Type,
            e.StartTime,
            e.ConfirmedTime,
            endTime,
            Math.Max(0, (endTime - e.StartTime) * 1000),
            e.PeakSeverity,
            e.SeveritySum / n,
            e.PeakConfidence,
            e.SpeedAtStart,
            e.Phase,
            e.OversteerType,
            new Dictionary<string, int>
            {
                ["ENTRY"] = e.PhaseSamples[(int)CornerPhase.Entry],
                ["MID_CORNER"] = e.PhaseSamples[(int)CornerPhase.MidCorner],
                ["EXIT"] = e.PhaseSamples[(int)CornerPhase.Exit],
                ["STRAIGHT"] = e.PhaseSamples[(int)CornerPhase.Straight],
            },
            e.ThrottleSum / n,
            e.BrakeSum / n,
            e.LapDistPctStart,
            e.LapDistPctEnd,
            endReason,
            _config.ModelVersion,
            CalibrationId));
    }

    private RotationModelResult Unknown(double? t, string reason)
    {
        _last = null;
        return new RotationModelResult
        {
            Timestamp = t,
            State = RotationState.Unknown,
            DisplayLabel = "",
            CornerPhase = CornerPhase.Straight,
            InvalidReason = reason,
            ModelVersion = _config.ModelVersion,
            CalibrationId = CalibrationId,
            IsCalibrated = _kind != ReferenceKind.None,
        };
    }
}
