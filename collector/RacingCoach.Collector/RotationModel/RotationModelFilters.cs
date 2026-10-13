namespace RacingCoach.Collector.Rotation;

/// <summary>The small numeric helpers of rotationModel.ts, with the same results.</summary>
internal static class RotationModelFilters
{
    public const double RadToDeg = 180 / Math.PI;

    /// <summary>The value is there and finite (ok() in rotationModel.ts).</summary>
    public static bool Ok(double? x) => x is { } v && double.IsFinite(v);

    /// <summary>0 at a, 1 at b, linear between (b > a).</summary>
    public static double Ramp(double x, double a, double b)
    {
        if (!(b > a))
            return x >= b ? 1 : 0;
        var v = (x - a) / (b - a);
        return v <= 0 ? 0 : v >= 1 ? 1 : v;
    }

    public static double Sign(double x) => x > 0 ? 1 : x < 0 ? -1 : 0;

    /// <summary>First-order low-pass over elapsed time: y += (1 - e^(-dt/tau)) (x - y). Without a previous value
    /// it starts at x.</summary>
    public static double LowPass(double? previous, double x, double dt, double tau)
    {
        if (previous is not { } p || tau <= 0)
            return x;
        return p + (1 - Math.Exp(-dt / tau)) * (x - p);
    }

    /// <summary>One term of a noisy-OR of supporting evidence (support() in rotationModel.ts): multiply the
    /// running "none of them" product by this. A missing term (null) leaves it unchanged.</summary>
    public static double NoneOf(double none, double? value, double weight) =>
        value is { } v ? none * (1 - Math.Min(1, Math.Max(0, weight)) * v) : none;
}
