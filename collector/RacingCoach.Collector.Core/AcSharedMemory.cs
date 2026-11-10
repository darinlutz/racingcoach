using System.Buffers.Binary;
using System.Numerics;
using System.Text;

namespace RacingCoach.Collector.Simulators;

/// <summary>
/// Reads Assetto Corsa's (the original's) three shared memory pages from their bytes. Values come back as AC stores
/// them, in its own units and axes: converting them into TelemetryFrame's is AcFrameBuilder's job, once each has been
/// checked in the game (docs/multi-simulator.md). No Windows APIs, so it runs and is tested anywhere.
///
/// The layout is Kunos's "AC Shared Memory Documentation" (docs/vendor/ACSharedMemoryDocumentation.pdf): the fields in
/// the document's order, each 4-byte value 4-byte aligned, so a wchar_t array with an odd length is followed by 2 bytes
/// of padding. The document gives no offsets; these were worked out from its field order (AcDocumentedLayout in the
/// tests holds them to it). Every field both games have sits where ACC's does, as ACC's pages grew from AC's.
///
/// AC, ACC and AC Rally use the same map names, so only the process tells them apart (AcAdapter checks it).
/// </summary>
public static class AcSharedMemory
{
    public const string PhysicsMapName = @"Local\acpmf_physics";
    public const string GraphicsMapName = @"Local\acpmf_graphics";
    public const string StaticMapName = @"Local\acpmf_static";

    // The documented pages' sizes. AC's maps are larger, and later versions are reported to add fields after these
    // (none documented), so the raw recorder keeps more than this (AcAdapter.RecordedBytes) for checking later.
    public const int PhysicsSize = 580;
    public const int GraphicsSize = 296;
    public const int StaticSize = 684;

    /// <summary>SPageFilePhysics, updated each step. Everything is the player's car.</summary>
    public static AcPhysics ReadPhysics(ReadOnlySpan<byte> page)
    {
        Require(page, PhysicsSize, "physics");
        return new AcPhysics
        {
            PacketId = Int(page, 0),
            Gas = Float(page, 4),
            Brake = Float(page, 8),
            Fuel = Float(page, 12),
            Gear = Int(page, 16),
            Rpm = Int(page, 20),
            SteerAngle = Float(page, 24),
            SpeedKmh = Float(page, 28),
            Velocity = Vector(page, 32),
            AccG = Vector(page, 44),
            WheelSlip = Wheels(page, 56),
            WheelLoad = Wheels(page, 72),
            WheelsPressure = Wheels(page, 88),
            WheelAngularSpeed = Wheels(page, 104),
            TyreWear = Wheels(page, 120),
            TyreDirtyLevel = Wheels(page, 136),
            TyreCoreTemperature = Wheels(page, 152),
            CamberRad = Wheels(page, 168),
            SuspensionTravel = Wheels(page, 184),
            Drs = Float(page, 200),
            Tc = Float(page, 204),
            Heading = Float(page, 208),
            Pitch = Float(page, 212),
            Roll = Float(page, 216),
            CgHeight = Float(page, 220),
            CarDamage = new AccCarDamage(Float(page, 224), Float(page, 228), Float(page, 232), Float(page, 236), Float(page, 240)),
            NumberOfTyresOut = Int(page, 244),
            PitLimiterOn = Int(page, 248) != 0,
            Abs = Float(page, 252),
            AutoShifterOn = Int(page, 264) != 0,
            RideHeightFront = Float(page, 268),
            RideHeightRear = Float(page, 272),
            TurboBoost = Float(page, 276),
            AirTemp = Float(page, 288),
            RoadTemp = Float(page, 292),
            LocalAngularVelocity = Vector(page, 296),
            FinalFf = Float(page, 308),
            BrakeTemp = Wheels(page, 348),
            Clutch = Float(page, 364),
            TyreTempInner = Wheels(page, 368),
            TyreTempMiddle = Wheels(page, 384),
            TyreTempOuter = Wheels(page, 400),
            IsAiControlled = Int(page, 416) != 0,
            BrakeBias = Float(page, 564),
            LocalVelocity = Vector(page, 568),
        };
    }

    /// <summary>SPageFileGraphic, updated each graphics step. Everything is the player's car.</summary>
    public static AcGraphics ReadGraphics(ReadOnlySpan<byte> page)
    {
        Require(page, GraphicsSize, "graphics");
        return new AcGraphics
        {
            PacketId = Int(page, 0),
            Status = (AcStatus)Int(page, 4),
            Session = (AcSessionType)Int(page, 8),
            CompletedLaps = Int(page, 132),
            Position = Int(page, 136),
            CurrentTimeMs = Int(page, 140),
            LastTimeMs = Int(page, 144),
            BestTimeMs = Int(page, 148),
            SessionTimeLeft = Float(page, 152),
            DistanceTraveled = Float(page, 156),
            IsInPit = Int(page, 160) != 0,
            CurrentSectorIndex = Int(page, 164),
            LastSectorTimeMs = Int(page, 168),
            NumberOfLaps = Int(page, 172),
            TyreCompound = String(page, 176, 33),
            ReplayTimeMultiplier = Float(page, 244),
            NormalizedCarPosition = Float(page, 248),
            CarCoordinates = Vector(page, 252),
            PenaltyTime = Float(page, 264),
            Flag = (AcFlag)Int(page, 268),
            IsInPitLane = Int(page, 276) != 0,
            SurfaceGrip = Float(page, 280),
            MandatoryPitDone = Int(page, 284) != 0,
            WindSpeed = Float(page, 288),
            WindDirection = Float(page, 292),
        };
    }

    /// <summary>SPageFileStatic, set when the game's instance starts.</summary>
    public static AcStatic ReadStatic(ReadOnlySpan<byte> page)
    {
        Require(page, StaticSize, "static");
        return new AcStatic
        {
            SmVersion = String(page, 0, 15),
            AcVersion = String(page, 30, 15),
            NumberOfSessions = Int(page, 60),
            NumCars = Int(page, 64),
            CarModel = String(page, 68, 33),
            Track = String(page, 134, 33),
            PlayerName = String(page, 200, 33),
            PlayerSurname = String(page, 266, 33),
            PlayerNick = String(page, 332, 33),
            SectorCount = Int(page, 400),
            MaxTorque = Float(page, 404),
            MaxPower = Float(page, 408),
            MaxRpm = Int(page, 412),
            MaxFuel = Float(page, 416),
            SuspensionMaxTravel = Wheels(page, 420),
            TyreRadius = Wheels(page, 436),
            PenaltiesEnabled = Int(page, 464) != 0,
            AidAutoClutch = Int(page, 488) != 0,
            TrackSplineLength = Float(page, 520),
            TrackConfiguration = String(page, 524, 33),
            IsTimedRace = Int(page, 596) != 0,
            CarSkin = String(page, 604, 33),
            PitWindowStart = Int(page, 676),
            PitWindowEnd = Int(page, 680),
        };
    }

    private static void Require(ReadOnlySpan<byte> page, int size, string name)
    {
        if (page.Length < size)
            throw new ArgumentException($"AC's {name} page is {size} bytes; got {page.Length}", nameof(page));
    }

    private static int Int(ReadOnlySpan<byte> page, int offset) => BinaryPrimitives.ReadInt32LittleEndian(page[offset..]);
    private static float Float(ReadOnlySpan<byte> page, int offset) => BinaryPrimitives.ReadSingleLittleEndian(page[offset..]);
    private static Vector3 Vector(ReadOnlySpan<byte> page, int offset) => new(Float(page, offset), Float(page, offset + 4), Float(page, offset + 8));

    // Kunos's wheel order in both games: front left, front right, rear left, rear right
    private static AccWheels Wheels(ReadOnlySpan<byte> page, int offset) =>
        new(Float(page, offset), Float(page, offset + 4), Float(page, offset + 8), Float(page, offset + 12));

    /// <summary>A wchar_t[length]: UTF-16, ending at the first NUL.</summary>
    private static string String(ReadOnlySpan<byte> page, int offset, int length)
    {
        var bytes = page.Slice(offset, 2 * length);
        var chars = 0;
        while (chars < length && BinaryPrimitives.ReadUInt16LittleEndian(bytes[(2 * chars)..]) != 0)
            chars++;
        return Encoding.Unicode.GetString(bytes[..(2 * chars)]);
    }
}

/// <summary>The physics page, as AC stores it. Where the document gives no unit or axis it's noted, and each must be
/// confirmed in the game before it reaches a lap file (ChannelGate).</summary>
public sealed record AcPhysics
{
    /// <summary>Goes up each physics step; standing still means the game is paused or gone.</summary>
    public int PacketId { get; init; }
    /// <summary>0-1.</summary>
    public float Gas { get; init; }
    /// <summary>0-1.</summary>
    public float Brake { get; init; }
    /// <summary>Liters, per the document.</summary>
    public float Fuel { get; init; }
    /// <summary>0 reverse, 1 neutral, 2 first, per the document.</summary>
    public int Gear { get; init; }
    public int Rpm { get; init; }
    /// <summary>"Angle of steer": whether an angle or a share of lock, and its sign, unconfirmed.</summary>
    public float SteerAngle { get; init; }
    public float SpeedKmh { get; init; }
    /// <summary>World coordinates.</summary>
    public Vector3 Velocity { get; init; }
    /// <summary>"Local related"; axes and signs unconfirmed.</summary>
    public Vector3 AccG { get; init; }
    public AccWheels WheelSlip { get; init; }
    /// <summary>N.</summary>
    public AccWheels WheelLoad { get; init; }
    /// <summary>No unit stated.</summary>
    public AccWheels WheelsPressure { get; init; }
    public AccWheels WheelAngularSpeed { get; init; }
    public AccWheels TyreWear { get; init; }
    public AccWheels TyreDirtyLevel { get; init; }
    public AccWheels TyreCoreTemperature { get; init; }
    /// <summary>Radians.</summary>
    public AccWheels CamberRad { get; init; }
    /// <summary>No unit stated.</summary>
    public AccWheels SuspensionTravel { get; init; }
    public float Drs { get; init; }
    public float Tc { get; init; }
    /// <summary>"Heading of the car on world coordinates"; zero and direction unconfirmed.</summary>
    public float Heading { get; init; }
    public float Pitch { get; init; }
    public float Roll { get; init; }
    public float CgHeight { get; init; }
    public AccCarDamage CarDamage { get; init; }
    /// <summary>Documented as how many tyres may leave the track without a penalty; community readers use it as how
    /// many are off it now. Unconfirmed.</summary>
    public int NumberOfTyresOut { get; init; }
    public bool PitLimiterOn { get; init; }
    /// <summary>"Slip ratio limit for the ABS (if enabled)": a setting, not ABS in action.</summary>
    public float Abs { get; init; }
    public bool AutoShifterOn { get; init; }
    /// <summary>One per axle; no unit stated.</summary>
    public float RideHeightFront { get; init; }
    public float RideHeightRear { get; init; }
    public float TurboBoost { get; init; }
    public float AirTemp { get; init; }
    public float RoadTemp { get; init; }
    /// <summary>Axes and signs unconfirmed.</summary>
    public Vector3 LocalAngularVelocity { get; init; }
    public float FinalFf { get; init; }
    public AccWheels BrakeTemp { get; init; }
    /// <summary>Documented as the pedal, 0-1 fully pressed (ACC's, documented the same, turned out to be engagement).</summary>
    public float Clutch { get; init; }
    /// <summary>Across each tire: inner, middle, outer (not left and right).</summary>
    public AccWheels TyreTempInner { get; init; }
    public AccWheels TyreTempMiddle { get; init; }
    public AccWheels TyreTempOuter { get; init; }
    public bool IsAiControlled { get; init; }
    /// <summary>0 rear to 1 front.</summary>
    public float BrakeBias { get; init; }
    /// <summary>Axes and signs unconfirmed.</summary>
    public Vector3 LocalVelocity { get; init; }
}

/// <summary>The graphics page, as AC stores it.</summary>
public sealed record AcGraphics
{
    public int PacketId { get; init; }
    public AcStatus Status { get; init; }
    public AcSessionType Session { get; init; }
    public int CompletedLaps { get; init; }
    public int Position { get; init; }
    public int CurrentTimeMs { get; init; }
    public int LastTimeMs { get; init; }
    public int BestTimeMs { get; init; }
    public float SessionTimeLeft { get; init; }
    /// <summary>Distance traveled during the instance, not the lap.</summary>
    public float DistanceTraveled { get; init; }
    /// <summary>Stopped in the pit.</summary>
    public bool IsInPit { get; init; }
    public int CurrentSectorIndex { get; init; }
    public int LastSectorTimeMs { get; init; }
    public int NumberOfLaps { get; init; }
    public string TyreCompound { get; init; } = "";
    public float ReplayTimeMultiplier { get; init; }
    /// <summary>The car on the track's spline, 0 to 1.</summary>
    public float NormalizedCarPosition { get; init; }
    /// <summary>The player's car in world coordinates (AC has only the player's here, where ACC lists every car).</summary>
    public Vector3 CarCoordinates { get; init; }
    public float PenaltyTime { get; init; }
    public AcFlag Flag { get; init; }
    public bool IsInPitLane { get; init; }
    public float SurfaceGrip { get; init; }
    public bool MandatoryPitDone { get; init; }
    /// <summary>No unit stated.</summary>
    public float WindSpeed { get; init; }
    /// <summary>Degrees, 0-359.</summary>
    public float WindDirection { get; init; }
}

/// <summary>The static page, as AC stores it.</summary>
public sealed record AcStatic
{
    public string SmVersion { get; init; } = "";
    public string AcVersion { get; init; } = "";
    public int NumberOfSessions { get; init; }
    public int NumCars { get; init; }
    /// <summary>The car's folder name, e.g. ks_porsche_911_gt3_r_2016 (mods have their own).</summary>
    public string CarModel { get; init; } = "";
    /// <summary>The track's folder name, e.g. spa or ks_nurburgring.</summary>
    public string Track { get; init; } = "";
    public string PlayerName { get; init; } = "";
    public string PlayerSurname { get; init; } = "";
    public string PlayerNick { get; init; } = "";
    public int SectorCount { get; init; }
    public float MaxTorque { get; init; }
    public float MaxPower { get; init; }
    public int MaxRpm { get; init; }
    public float MaxFuel { get; init; }
    public AccWheels SuspensionMaxTravel { get; init; }
    public AccWheels TyreRadius { get; init; }
    public bool PenaltiesEnabled { get; init; }
    public bool AidAutoClutch { get; init; }
    /// <summary>"Length of the spline of the selected track"; meters expected, unconfirmed.</summary>
    public float TrackSplineLength { get; init; }
    /// <summary>The layout's folder name on multi-layout tracks (e.g. layout_gp_a), empty otherwise.</summary>
    public string TrackConfiguration { get; init; } = "";
    public bool IsTimedRace { get; init; }
    public string CarSkin { get; init; } = "";
    public int PitWindowStart { get; init; }
    public int PitWindowEnd { get; init; }
}

public enum AcStatus
{
    Off = 0,
    Replay = 1,
    Live = 2,
    Pause = 3,
}

public enum AcSessionType
{
    Unknown = -1,
    Practice = 0,
    Qualify = 1,
    Race = 2,
    Hotlap = 3,
    TimeAttack = 4,
    Drift = 5,
    Drag = 6,
}

public enum AcFlag
{
    None = 0,
    Blue = 1,
    Yellow = 2,
    Black = 3,
    White = 4,
    Checkered = 5,
    Penalty = 6,
}
