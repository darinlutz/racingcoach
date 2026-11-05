using System.Buffers.Binary;
using System.Numerics;
using System.Text;

namespace RacingCoach.Collector.Simulators;

/// <summary>
/// Reads Assetto Corsa Competizione's three shared memory pages from their bytes. Values come back as ACC stores them,
/// in its own units and axes: converting them into TelemetryFrame's is the adapter's job, once each has been checked in
/// the game (docs/multi-simulator.md). No Windows APIs, so it runs and is tested anywhere.
///
/// The layout is Kunos's "ACC Shared Memory v1.8.12": the fields in the document's order, each 4-byte value 4-byte
/// aligned, so a wchar_t array with an odd length is followed by 2 bytes of padding (the C header's #pragma pack(4)
/// gives the same, as nothing is wider than 4 bytes). The document gives no offsets; these were worked out from its
/// field order and agree with PyAccSharedMemory's reader. Fields the document marks as not used by ACC are left out.
/// </summary>
public static class AccSharedMemory
{
    public const string PhysicsMapName = @"Local\acpmf_physics";
    public const string GraphicsMapName = @"Local\acpmf_graphics";
    public const string StaticMapName = @"Local\acpmf_static";

    public const int PhysicsSize = 800;
    public const int GraphicsSize = 1588;
    public const int StaticSize = 820;

    /// <summary>carCoordinates and carID hold this many cars.</summary>
    public const int MaxCars = 60;

    /// <summary>SPageFilePhysics, updated each physics step. Everything is the player's car.</summary>
    public static AccPhysics ReadPhysics(ReadOnlySpan<byte> page)
    {
        Require(page, PhysicsSize, "physics");
        return new AccPhysics
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
            WheelPressure = Wheels(page, 88),
            WheelAngularSpeed = Wheels(page, 104),
            TyreCoreTemp = Wheels(page, 152),
            SuspensionTravel = Wheels(page, 184),
            Tc = Float(page, 204),
            Heading = Float(page, 208),
            Pitch = Float(page, 212),
            Roll = Float(page, 216),
            CarDamage = new AccCarDamage(Float(page, 224), Float(page, 228), Float(page, 232), Float(page, 236), Float(page, 240)),
            PitLimiterOn = Int(page, 248) != 0,
            Abs = Float(page, 252),
            AutoShifterOn = Int(page, 264) != 0,
            TurboBoost = Float(page, 276),
            AirTemp = Float(page, 288),
            RoadTemp = Float(page, 292),
            LocalAngularVelocity = Vector(page, 296),
            FinalFf = Float(page, 308),
            BrakeTemp = Wheels(page, 348),
            Clutch = Float(page, 364),
            IsAiControlled = Int(page, 416) != 0,
            BrakeBias = Float(page, 564),
            LocalVelocity = Vector(page, 568),
            SlipRatio = Wheels(page, 640),
            SlipAngle = Wheels(page, 656),
            WaterTemp = Float(page, 712),
            BrakePressure = Wheels(page, 716),
            FrontBrakeCompound = Int(page, 732),
            RearBrakeCompound = Int(page, 736),
            PadLife = Wheels(page, 740),
            DiscLife = Wheels(page, 756),
            IgnitionOn = Int(page, 772) != 0,
            StarterEngineOn = Int(page, 776) != 0,
            IsEngineRunning = Int(page, 780) != 0,
        };
    }

    /// <summary>SPageFileGraphic, updated each graphics step. The player's car, except carCoordinates and carID.</summary>
    public static AccGraphics ReadGraphics(ReadOnlySpan<byte> page)
    {
        Require(page, GraphicsSize, "graphics");
        var activeCars = Int(page, 252);
        var playerCarId = Int(page, 1216);
        Vector3? player = null;
        for (var i = 0; i < Math.Clamp(activeCars, 0, MaxCars); i++)
        {
            if (Int(page, 976 + 4 * i) != playerCarId)
                continue;
            player = Vector(page, 256 + 12 * i);
            break;
        }

        return new AccGraphics
        {
            PacketId = Int(page, 0),
            Status = (AccStatus)Int(page, 4),
            Session = (AccSessionType)Int(page, 8),
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
            NormalizedCarPosition = Float(page, 248),
            ActiveCars = activeCars,
            PlayerCarId = playerCarId,
            PlayerCoordinates = player,
            PenaltyTime = Float(page, 1220),
            Flag = (AccFlag)Int(page, 1224),
            Penalty = Int(page, 1228),
            IsInPitLane = Int(page, 1236) != 0,
            SurfaceGrip = Float(page, 1240),
            MandatoryPitDone = Int(page, 1244) != 0,
            WindSpeed = Float(page, 1248),
            WindDirection = Float(page, 1252),
            IsSetupMenuVisible = Int(page, 1256) != 0,
            TcLevel = Int(page, 1268),
            TcCutLevel = Int(page, 1272),
            EngineMap = Int(page, 1276),
            AbsLevel = Int(page, 1280),
            FuelPerLap = Float(page, 1284),
            RainTyres = Int(page, 1316) != 0,
            SessionIndex = Int(page, 1320),
            UsedFuel = Float(page, 1324),
            DeltaLapTimeMs = Int(page, 1360),
            EstimatedLapTimeMs = Int(page, 1396),
            SplitMs = Int(page, 1404),
            IsValidLap = Int(page, 1408) != 0,
            FuelEstimatedLaps = Float(page, 1412),
            TrackStatus = String(page, 1416, 33),
            MissingMandatoryPits = Int(page, 1484),
            Clock = Float(page, 1488),
            GlobalYellow = Int(page, 1500) != 0,
            GlobalWhite = Int(page, 1516) != 0,
            GlobalGreen = Int(page, 1520) != 0,
            GlobalChequered = Int(page, 1524) != 0,
            GlobalRed = Int(page, 1528) != 0,
            TrackGripStatus = (AccTrackGrip)Int(page, 1556),
            RainIntensity = (AccRainIntensity)Int(page, 1560),
            RainIntensityIn10Min = (AccRainIntensity)Int(page, 1564),
            RainIntensityIn30Min = (AccRainIntensity)Int(page, 1568),
            GapAheadMs = Int(page, 1580),
            GapBehindMs = Int(page, 1584),
        };
    }

    /// <summary>SPageFileStatic, set when the game's instance starts.</summary>
    public static AccStatic ReadStatic(ReadOnlySpan<byte> page)
    {
        Require(page, StaticSize, "static");
        return new AccStatic
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
            MaxRpm = Int(page, 412),
            MaxFuel = Float(page, 416),
            PenaltiesEnabled = Int(page, 464) != 0,
            PitWindowStart = Int(page, 676),
            PitWindowEnd = Int(page, 680),
            IsOnline = Int(page, 684) != 0,
            DryTyresName = String(page, 688, 33),
            WetTyresName = String(page, 754, 33),
        };
    }

    private static void Require(ReadOnlySpan<byte> page, int size, string name)
    {
        if (page.Length < size)
            throw new ArgumentException($"ACC's {name} page is {size} bytes; got {page.Length}", nameof(page));
    }

    private static int Int(ReadOnlySpan<byte> page, int offset) => BinaryPrimitives.ReadInt32LittleEndian(page[offset..]);
    private static float Float(ReadOnlySpan<byte> page, int offset) => BinaryPrimitives.ReadSingleLittleEndian(page[offset..]);
    private static Vector3 Vector(ReadOnlySpan<byte> page, int offset) => new(Float(page, offset), Float(page, offset + 4), Float(page, offset + 8));

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

/// <summary>One value per wheel, in ACC's order.</summary>
public readonly record struct AccWheels(float FrontLeft, float FrontRight, float RearLeft, float RearRight);

/// <summary>carDamage[5]: front, rear, left, right, centre.</summary>
public readonly record struct AccCarDamage(float Front, float Rear, float Left, float Right, float Centre);

/// <summary>The physics page, as ACC stores it. The document gives no unit for several of these (noted), so each must
/// be confirmed in the game before it's converted.</summary>
public sealed record AccPhysics
{
    /// <summary>Goes up each physics step; standing still means the game is paused or gone.</summary>
    public int PacketId { get; init; }
    /// <summary>0-1.</summary>
    public float Gas { get; init; }
    /// <summary>0-1.</summary>
    public float Brake { get; init; }
    /// <summary>The document says kg; community readers say liters. Unconfirmed.</summary>
    public float Fuel { get; init; }
    /// <summary>Numbering not stated in the document.</summary>
    public int Gear { get; init; }
    public int Rpm { get; init; }
    /// <summary>The steering input, -1 to 1; not an angle. Sign unconfirmed.</summary>
    public float SteerAngle { get; init; }
    public float SpeedKmh { get; init; }
    /// <summary>Global coordinates.</summary>
    public Vector3 Velocity { get; init; }
    /// <summary>The document says global coordinates and gives no unit.</summary>
    public Vector3 AccG { get; init; }
    public AccWheels WheelSlip { get; init; }
    /// <summary>No unit stated.</summary>
    public AccWheels WheelPressure { get; init; }
    /// <summary>rad/s.</summary>
    public AccWheels WheelAngularSpeed { get; init; }
    /// <summary>One core temperature per tire.</summary>
    public AccWheels TyreCoreTemp { get; init; }
    /// <summary>No unit stated.</summary>
    public AccWheels SuspensionTravel { get; init; }
    /// <summary>Traction control in action.</summary>
    public float Tc { get; init; }
    /// <summary>Yaw; zero and direction unconfirmed.</summary>
    public float Heading { get; init; }
    public float Pitch { get; init; }
    public float Roll { get; init; }
    public AccCarDamage CarDamage { get; init; }
    public bool PitLimiterOn { get; init; }
    /// <summary>ABS in action.</summary>
    public float Abs { get; init; }
    public bool AutoShifterOn { get; init; }
    public float TurboBoost { get; init; }
    public float AirTemp { get; init; }
    public float RoadTemp { get; init; }
    /// <summary>Local coordinates; which axis is yaw, and its sign, unconfirmed.</summary>
    public Vector3 LocalAngularVelocity { get; init; }
    public float FinalFf { get; init; }
    public AccWheels BrakeTemp { get; init; }
    /// <summary>The clutch pedal, 0-1: a pedal position, the opposite of iRacing's engagement.</summary>
    public float Clutch { get; init; }
    public bool IsAiControlled { get; init; }
    /// <summary>Front brake bias; the dash shows it with a per-car offset (AccCars).</summary>
    public float BrakeBias { get; init; }
    /// <summary>Local coordinates; axes and signs unconfirmed.</summary>
    public Vector3 LocalVelocity { get; init; }
    /// <summary>The document says "in radians".</summary>
    public AccWheels SlipRatio { get; init; }
    public AccWheels SlipAngle { get; init; }
    public float WaterTemp { get; init; }
    public AccWheels BrakePressure { get; init; }
    public int FrontBrakeCompound { get; init; }
    public int RearBrakeCompound { get; init; }
    public AccWheels PadLife { get; init; }
    public AccWheels DiscLife { get; init; }
    public bool IgnitionOn { get; init; }
    public bool StarterEngineOn { get; init; }
    public bool IsEngineRunning { get; init; }
}

/// <summary>The graphics page, as ACC stores it.</summary>
public sealed record AccGraphics
{
    public int PacketId { get; init; }
    public AccStatus Status { get; init; }
    public AccSessionType Session { get; init; }
    public int CompletedLaps { get; init; }
    public int Position { get; init; }
    public int CurrentTimeMs { get; init; }
    public int LastTimeMs { get; init; }
    public int BestTimeMs { get; init; }
    public float SessionTimeLeft { get; init; }
    /// <summary>The stint's distance, not the lap's.</summary>
    public float DistanceTraveled { get; init; }
    public bool IsInPit { get; init; }
    public int CurrentSectorIndex { get; init; }
    public int LastSectorTimeMs { get; init; }
    public int NumberOfLaps { get; init; }
    public string TyreCompound { get; init; } = "";
    /// <summary>The car on the track's spline, 0 at the start to 1 at the finish.</summary>
    public float NormalizedCarPosition { get; init; }
    public int ActiveCars { get; init; }
    public int PlayerCarId { get; init; }
    /// <summary>The player's carCoordinates, found by playerCarID in carID; null when the player's car isn't listed.
    /// World coordinates, not latitude and longitude.</summary>
    public Vector3? PlayerCoordinates { get; init; }
    public float PenaltyTime { get; init; }
    public AccFlag Flag { get; init; }
    /// <summary>ACC_PENALTY_TYPE.</summary>
    public int Penalty { get; init; }
    public bool IsInPitLane { get; init; }
    public float SurfaceGrip { get; init; }
    public bool MandatoryPitDone { get; init; }
    /// <summary>m/s.</summary>
    public float WindSpeed { get; init; }
    /// <summary>Radians.</summary>
    public float WindDirection { get; init; }
    public bool IsSetupMenuVisible { get; init; }
    public int TcLevel { get; init; }
    public int TcCutLevel { get; init; }
    public int EngineMap { get; init; }
    public int AbsLevel { get; init; }
    /// <summary>Average fuel used per lap, in liters.</summary>
    public float FuelPerLap { get; init; }
    public bool RainTyres { get; init; }
    public int SessionIndex { get; init; }
    public float UsedFuel { get; init; }
    public int DeltaLapTimeMs { get; init; }
    public int EstimatedLapTimeMs { get; init; }
    public int SplitMs { get; init; }
    /// <summary>The lap counts for timing.</summary>
    public bool IsValidLap { get; init; }
    public float FuelEstimatedLaps { get; init; }
    public string TrackStatus { get; init; } = "";
    public int MissingMandatoryPits { get; init; }
    /// <summary>Time of day, in seconds.</summary>
    public float Clock { get; init; }
    public bool GlobalYellow { get; init; }
    public bool GlobalWhite { get; init; }
    public bool GlobalGreen { get; init; }
    public bool GlobalChequered { get; init; }
    public bool GlobalRed { get; init; }
    public AccTrackGrip TrackGripStatus { get; init; }
    public AccRainIntensity RainIntensity { get; init; }
    public AccRainIntensity RainIntensityIn10Min { get; init; }
    public AccRainIntensity RainIntensityIn30Min { get; init; }
    public int GapAheadMs { get; init; }
    public int GapBehindMs { get; init; }
}

/// <summary>The static page, as ACC stores it.</summary>
public sealed record AccStatic
{
    public string SmVersion { get; init; } = "";
    public string AcVersion { get; init; } = "";
    public int NumberOfSessions { get; init; }
    public int NumCars { get; init; }
    /// <summary>Kunos's car id, e.g. porsche_991ii_gt3_r (AccCars).</summary>
    public string CarModel { get; init; } = "";
    /// <summary>Kunos's track id, e.g. Spa. ACC has one layout per track (trackConfiguration is marked not used).</summary>
    public string Track { get; init; } = "";
    public string PlayerName { get; init; } = "";
    public string PlayerSurname { get; init; } = "";
    public string PlayerNick { get; init; } = "";
    public int SectorCount { get; init; }
    public int MaxRpm { get; init; }
    public float MaxFuel { get; init; }
    public bool PenaltiesEnabled { get; init; }
    public int PitWindowStart { get; init; }
    public int PitWindowEnd { get; init; }
    public bool IsOnline { get; init; }
    public string DryTyresName { get; init; } = "";
    public string WetTyresName { get; init; } = "";
}

public enum AccStatus
{
    Off = 0,
    Replay = 1,
    Live = 2,
    Pause = 3,
}

public enum AccSessionType
{
    Unknown = -1,
    Practice = 0,
    Qualify = 1,
    Race = 2,
    Hotlap = 3,
    TimeAttack = 4,
    Drift = 5,
    Drag = 6,
    Hotstint = 7,
    HotstintSuperpole = 8,
}

public enum AccFlag
{
    None = 0,
    Blue = 1,
    Yellow = 2,
    Black = 3,
    White = 4,
    Checkered = 5,
    Penalty = 6,
    Green = 7,
    Orange = 8,
}

public enum AccTrackGrip
{
    Green = 0,
    Fast = 1,
    Optimum = 2,
    Greasy = 3,
    Damp = 4,
    Wet = 5,
    Flooded = 6,
}

public enum AccRainIntensity
{
    NoRain = 0,
    Drizzle = 1,
    LightRain = 2,
    MediumRain = 3,
    HeavyRain = 4,
    Thunderstorm = 5,
}
