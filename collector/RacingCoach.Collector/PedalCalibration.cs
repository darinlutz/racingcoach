namespace RacingCoach.Collector;

/// <summary>
/// Brake Practice's pedal calibration: finds which axis is the brake (the one that moves when the driver presses
/// it) and how far it travels, from two full presses. No I/O; the window feeds it the axes every frame.
/// </summary>
internal sealed class PedalCalibration
{
    public const int PressesNeeded = 2;
    // Fractions of the axis's whole range: a press starts past PressStart and ends back under PressEnd
    private const double PressStart = 0.30;
    private const double PressEnd = 0.10;
    // Below this share of the calibrated travel the pedal reads 0%, so a load cell's noise at rest doesn't show
    private const double Deadzone = 0.01;

    // Each axis's position when first seen, taken as its rest position
    private readonly Dictionary<PedalAxis, double> _rest = [];
    private readonly List<double> _peaks = [];
    private double _restFraction;
    private int _direction; // +1 if pressing raises the axis, -1 if it lowers it
    private bool _pressing;
    private double _pressPeak;
    private double _fullTravel;

    /// <summary>The brake's axis, once it has been pressed far enough to tell.</summary>
    public PedalAxis? Axis { get; private set; }
    public int Presses => _peaks.Count;
    public bool Complete => _peaks.Count >= PressesNeeded;

    /// <summary>
    /// While calibrating: how far the pedal is pressed as a share of its axis's whole range (0-100), for the
    /// position shown; the most moved axis until the brake's is known. Null before any axis has moved.
    /// </summary>
    public double? RawPercent { get; private set; }

    /// <summary>Feeds every axis's latest value; call once a frame until <see cref="Complete"/>.</summary>
    public void Update(IEnumerable<PedalAxis> axes)
    {
        if (Complete)
            return;
        if (Axis is null && !FindAxis(axes))
            return;

        var travel = Travel(Axis!);
        RawPercent = Math.Max(0, travel) * 100;
        if (!_pressing && travel >= PressStart)
        {
            _pressing = true;
            _pressPeak = travel;
        }
        else if (_pressing)
        {
            _pressPeak = Math.Max(_pressPeak, travel);
            if (travel <= PressEnd)
            {
                _pressing = false;
                _peaks.Add(_pressPeak);
                if (Complete)
                    _fullTravel = _peaks.Average();
            }
        }
    }

    /// <summary>The calibrated brake, 0-100%: 0 at rest, 100 at the average of the two full presses.</summary>
    public double? Percent
    {
        get
        {
            if (!Complete || Axis is null || !Axis.Device.Connected)
                return null;
            var share = Travel(Axis) / _fullTravel;
            return share < Deadzone ? 0 : Math.Clamp(share, 0, 1) * 100;
        }
    }

    // Picks the axis that has moved furthest from rest once it passes the start of a press
    private bool FindAxis(IEnumerable<PedalAxis> axes)
    {
        PedalAxis? best = null;
        double bestMove = 0;
        foreach (var axis in axes)
        {
            if (!axis.HasValue || !axis.Device.Connected)
                continue;
            var fraction = axis.Fraction;
            if (!_rest.TryGetValue(axis, out var rest))
            {
                _rest[axis] = fraction;
                continue;
            }
            var move = Math.Abs(fraction - rest);
            if (move > bestMove)
                (best, bestMove) = (axis, move);
        }
        RawPercent = best is null ? null : bestMove * 100;
        if (best is null || bestMove < PressStart)
            return false;
        Axis = best;
        _restFraction = _rest[best];
        _direction = best.Fraction >= _restFraction ? 1 : -1;
        return true;
    }

    // How far the axis is from rest toward pressed, as a share of its whole range
    private double Travel(PedalAxis axis) => (axis.Fraction - _restFraction) * _direction;
}
