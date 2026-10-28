namespace RacingCoach.Collector;

/// <summary>
/// Brake Practice's game: three of the Target Lap's braking zones, a random mix of heavy and medium ones, each with
/// a stretch of no brake before it and its trail off smoothed, played back at the Target Lap's own pace (one row
/// per 60 Hz sample) <see cref="Runs"/> times in a row, with the brake beeps 300, 200 and 100 ft before each
/// brakepoint and at it, like BrakeBeeps on track. The beeps are placed from the Target Lap's speeds, or from its
/// LapDistPct and the track's length from sites before it sent speeds. No I/O or UI.
/// </summary>
internal sealed class BrakeDrill
{
    public const int SampleRate = 60; // a lap CSV's rows
    public const int Runs = 3;
    public const int ZonesPerDrill = 3;
    private const double OnBrake = 0.03;        // brake above this is braking
    private const double OffSeconds = 0.25;     // under it this long ends a zone
    private const double MinZoneSeconds = 0.4;
    private const double HeavyPeak = 0.65;
    private const double MediumPeak = 0.3;      // a zone that peaks lower is left out
    private const double MinLeadSeconds = 3;    // of no brake before each brakepoint, at least
    private const double LeadBeforeBeeps = 1.5; // and this long before its first beep
    private const double TailSeconds = 1.5;     // after the last zone of a run
    private const double TaperSeconds = 0.15;   // a zone that ends above 0 fades out over this
    private const int ApplySmoothing = 3;       // samples each side: about 50 ms
    private const int ReleaseSmoothing = 10;    // about 170 ms, so the trail off is smooth
    private const double FeetPerMeter = 3.280839895;
    // Without speeds or a track length, warnings this far apart, like the window's Test button
    private const double FallbackBeepSpacing = 0.6;

    /// <summary>A braking zone of the Target Lap: its first and last braking samples, its highest brake (0-1) and
    /// whether that makes it heavy (else medium).</summary>
    public sealed record Zone(int Start, int End, double Peak, bool Heavy);

    /// <summary>Where a zone is in each run, in seconds from the run's start: its brakepoint and where its
    /// braking ends.</summary>
    public sealed record Segment(Zone Zone, double Brakepoint, double End);

    /// <summary>The brake (0-1) at each 60 Hz sample, all the runs one after another.</summary>
    public double[] Brakes { get; }

    /// <summary>When each beep plays, in seconds from the start, in order, and whether it's the brakepoint's.</summary>
    public IReadOnlyList<(double Time, bool Brakepoint)> Beeps { get; }

    /// <summary>The zones of one run, in the order they come.</summary>
    public IReadOnlyList<Segment> Segments { get; }

    public double RunSeconds { get; }

    public double Seconds => Brakes.Length / (double)SampleRate;

    private BrakeDrill(double[] brakes, IReadOnlyList<(double, bool)> beeps, IReadOnlyList<Segment> segments, double runSeconds)
    {
        Brakes = brakes;
        Beeps = beeps;
        Segments = segments;
        RunSeconds = runSeconds;
    }

    /// <summary>The brake (0-1) at a time from the start, between samples; 0 outside the drill.</summary>
    public double BrakeAt(double seconds)
    {
        var at = seconds * SampleRate;
        if (at < 0 || at > Brakes.Length - 1)
            return 0;
        var i = (int)at;
        return i + 1 < Brakes.Length ? Brakes[i] + (Brakes[i + 1] - Brakes[i]) * (at - i) : Brakes[i];
    }

    /// <summary>The Target Lap's heavy and medium braking zones, in lap order. A zone it's already braking in at
    /// the start/finish line is left out, as its brakepoint is on the lap before.</summary>
    public static List<Zone> FindZones(TargetLapTrace lap)
    {
        var brakes = lap.Brakes;
        var zones = new List<Zone>();
        var offSamples = (int)(OffSeconds * SampleRate);
        var i = 0;
        while (i < brakes.Length)
        {
            if (brakes[i] <= OnBrake)
            {
                i++;
                continue;
            }
            var start = i;
            var end = i;
            var off = 0;
            for (i++; i < brakes.Length && off < offSamples; i++)
            {
                if (brakes[i] > OnBrake)
                {
                    end = i;
                    off = 0;
                }
                else
                {
                    off++;
                }
            }
            var peak = 0.0;
            for (var j = start; j <= end; j++)
                peak = Math.Max(peak, brakes[j]);
            if (start > 0 && end - start + 1 >= MinZoneSeconds * SampleRate && peak >= MediumPeak)
                zones.Add(new Zone(start, end, Math.Min(peak, 1), peak >= HeavyPeak));
        }
        return zones;
    }

    /// <summary>Three zones in a random order: one or two heavy ones and the rest medium when the lap has both
    /// (otherwise whatever it has), and not the same three as last time when the lap has more.</summary>
    public static List<Zone> Pick(IReadOnlyList<Zone> zones, IReadOnlyList<Zone>? last, Random random)
    {
        var heavy = zones.Where(z => z.Heavy).ToList();
        var medium = zones.Where(z => !z.Heavy).ToList();
        List<Zone> picked = [];
        for (var attempt = 0; attempt < 20; attempt++)
        {
            var heavyCount = Math.Min(heavy.Count, medium.Count == 0 ? ZonesPerDrill : random.Next(1, ZonesPerDrill));
            picked = Shuffle(heavy, random).Take(heavyCount)
                .Concat(Shuffle(medium, random).Take(ZonesPerDrill - heavyCount))
                .ToList();
            // Not enough medium ones: more heavy ones
            picked.AddRange(Shuffle(heavy.Except(picked).ToList(), random).Take(ZonesPerDrill - picked.Count));
            picked = Shuffle(picked, random);
            if (last is null || zones.Count <= ZonesPerDrill || !picked.ToHashSet().SetEquals(last))
                break;
        }
        return picked;
    }

    /// <summary>The drill of these zones of the lap. trackLengthFeet places the beeps when the lap has no speeds
    /// (0 when unknown).</summary>
    public static BrakeDrill Build(TargetLapTrace lap, IReadOnlyList<Zone> zones, double trackLengthFeet)
    {
        var run = new List<double>();
        var runBeeps = new List<(double Time, bool Brakepoint)>();
        var segments = new List<Segment>();
        foreach (var zone in zones)
        {
            var warnings = BrakeBeeps.WarningFeet
                .Select((feet, k) => SecondsBefore(lap, zone.Start, feet, trackLengthFeet)
                    ?? FallbackBeepSpacing * (BrakeBeeps.WarningFeet.Length - k))
                .ToArray();
            var lead = Math.Max(MinLeadSeconds, warnings.Max() + LeadBeforeBeeps);
            run.AddRange(Enumerable.Repeat(0.0, (int)Math.Round(lead * SampleRate)));
            var brakepoint = run.Count / (double)SampleRate;
            runBeeps.AddRange(warnings.Select(w => (brakepoint - w, false)));
            runBeeps.Add((brakepoint, true));
            run.AddRange(Smooth(lap.Brakes[zone.Start..(zone.End + 1)]));
            segments.Add(new Segment(zone, brakepoint, run.Count / (double)SampleRate));
        }
        run.AddRange(Enumerable.Repeat(0.0, (int)Math.Round(TailSeconds * SampleRate)));

        var runSeconds = run.Count / (double)SampleRate;
        var brakes = Enumerable.Repeat(run, Runs).SelectMany(r => r).ToArray();
        var beeps = Enumerable.Range(0, Runs)
            .SelectMany(r => runBeeps.Select(b => (b.Time + r * runSeconds, b.Brakepoint)))
            .OrderBy(b => b.Item1)
            .ToList();
        return new BrakeDrill(brakes, beeps, segments, runSeconds);
    }

    /// <summary>A zone's brake with its trail off smoothed: the press a little, then from the peak down a curve
    /// that only falls, rounded, and faded to 0 at the end.</summary>
    internal static double[] Smooth(double[] zone)
    {
        var smoothed = MovingAverage(zone.Select(b => Math.Clamp(b, 0, 1)).ToArray(), ApplySmoothing);
        var peak = Array.IndexOf(smoothed, smoothed.Max());
        var release = MovingAverage(NonIncreasing(smoothed[peak..]), ReleaseSmoothing);
        var taper = smoothed.Length > 0 && release[^1] > 0 ? (int)(TaperSeconds * SampleRate) : 0;
        return smoothed[..peak]
            .Concat(release)
            .Concat(Enumerable.Range(1, taper).Select(k => release[^1] * (1 - k / (double)taper)))
            .ToArray();
    }

    // The closest curve that never goes up (pool adjacent violators), so dips and bumps in the release go
    private static double[] NonIncreasing(double[] values)
    {
        var blocks = new List<(double Sum, int Count)>();
        foreach (var value in values)
        {
            blocks.Add((value, 1));
            while (blocks.Count > 1 && blocks[^2].Sum / blocks[^2].Count < blocks[^1].Sum / blocks[^1].Count)
            {
                var merged = (blocks[^2].Sum + blocks[^1].Sum, blocks[^2].Count + blocks[^1].Count);
                blocks.RemoveAt(blocks.Count - 1);
                blocks[^1] = merged;
            }
        }
        return blocks.SelectMany(b => Enumerable.Repeat(b.Sum / b.Count, b.Count)).ToArray();
    }

    // Each value averaged with radius values each side, the ends repeated past the edges (so the peak holds)
    private static double[] MovingAverage(double[] values, int radius)
    {
        var averaged = new double[values.Length];
        for (var i = 0; i < values.Length; i++)
        {
            var sum = 0.0;
            for (var j = i - radius; j <= i + radius; j++)
                sum += values[Math.Clamp(j, 0, values.Length - 1)];
            averaged[i] = sum / (2 * radius + 1);
        }
        return averaged;
    }

    // How long before the brakepoint (sample start) the Target Lap was feet before it; carries on at its speed at
    // the start of the lap when that's not far enough back. Null when the lap's distances aren't known.
    private static double? SecondsBefore(TargetLapTrace lap, int start, double feet, double trackLengthFeet)
    {
        var speeds = lap.Speeds is { } s && s.Length == lap.Brakes.Length && s.Any(v => v > 0) ? s : null;
        if (speeds is null && (trackLengthFeet <= 0 || lap.Pcts.Length != lap.Brakes.Length))
            return null;
        // Feet travelled in the sample before sample i
        double Step(int i) => speeds is not null
            ? speeds[i] * FeetPerMeter / SampleRate
            : (lap.Pcts[Math.Min(i + 1, lap.Pcts.Length - 1)] - lap.Pcts[i]) * trackLengthFeet;

        var covered = 0.0;
        for (var i = start - 1; i >= 0; i--)
        {
            covered += Step(i);
            if (covered >= feet)
                return (start - i) / (double)SampleRate;
        }
        var perSecond = Step(0) * SampleRate;
        return perSecond > 0 ? start / (double)SampleRate + (feet - covered) / perSecond : null;
    }

    private static List<Zone> Shuffle(List<Zone> zones, Random random) => zones.OrderBy(_ => random.Next()).ToList();
}
