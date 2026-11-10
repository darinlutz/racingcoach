using System.Buffers.Binary;
using System.Numerics;
using System.Text;
using RacingCoach.Collector.Simulators;

namespace RacingCoach.Collector.Core.Tests;

using static DocumentedPages;

/// <summary>
/// Holds AccSharedMemory's offsets to Kunos's document: pages are built from the document's field list
/// (AccDocumentedLayout, generated from the PDF), laid out by its order and C's alignment, and read back through the
/// parser. A field read from the wrong place, or a size off by a padding, fails here. What the document can't settle
/// (units, axes, signs, smVersion 1.9) needs recordings from the game.
/// </summary>
public sealed class AccSharedMemoryTests
{
    // Every field the parser reads, by its name in the document
    private static readonly (string Page, string Field, Func<byte[], object> Read)[] Mapped =
    [
        ("Physics", "packetId", b => Physics(b).PacketId),
        ("Physics", "gas", b => Physics(b).Gas),
        ("Physics", "brake", b => Physics(b).Brake),
        ("Physics", "fuel", b => Physics(b).Fuel),
        ("Physics", "gear", b => Physics(b).Gear),
        ("Physics", "rpm", b => Physics(b).Rpm),
        ("Physics", "steerAngle", b => Physics(b).SteerAngle),
        ("Physics", "speedKmh", b => Physics(b).SpeedKmh),
        ("Physics", "velocity", b => Physics(b).Velocity),
        ("Physics", "accG", b => Physics(b).AccG),
        ("Physics", "wheelSlip", b => Physics(b).WheelSlip),
        ("Physics", "wheelPressure", b => Physics(b).WheelPressure),
        ("Physics", "wheelAngularSpeed", b => Physics(b).WheelAngularSpeed),
        ("Physics", "TyreCoreTemp", b => Physics(b).TyreCoreTemp),
        ("Physics", "suspensionTravel", b => Physics(b).SuspensionTravel),
        ("Physics", "tc", b => Physics(b).Tc),
        ("Physics", "heading", b => Physics(b).Heading),
        ("Physics", "pitch", b => Physics(b).Pitch),
        ("Physics", "roll", b => Physics(b).Roll),
        ("Physics", "carDamage", b => Physics(b).CarDamage),
        ("Physics", "pitLimiterOn", b => Physics(b).PitLimiterOn),
        ("Physics", "abs", b => Physics(b).Abs),
        ("Physics", "autoshifterOn", b => Physics(b).AutoShifterOn),
        ("Physics", "turboBoost", b => Physics(b).TurboBoost),
        ("Physics", "airTemp", b => Physics(b).AirTemp),
        ("Physics", "roadTemp", b => Physics(b).RoadTemp),
        ("Physics", "localAngularVel", b => Physics(b).LocalAngularVelocity),
        ("Physics", "finalFF", b => Physics(b).FinalFf),
        ("Physics", "brakeTemp", b => Physics(b).BrakeTemp),
        ("Physics", "clutch", b => Physics(b).Clutch),
        ("Physics", "isAIControlled", b => Physics(b).IsAiControlled),
        ("Physics", "brakeBias", b => Physics(b).BrakeBias),
        ("Physics", "localVelocity", b => Physics(b).LocalVelocity),
        ("Physics", "slipRatio", b => Physics(b).SlipRatio),
        ("Physics", "slipAngle", b => Physics(b).SlipAngle),
        ("Physics", "waterTemp", b => Physics(b).WaterTemp),
        ("Physics", "brakePressure", b => Physics(b).BrakePressure),
        ("Physics", "frontBrakeCompound", b => Physics(b).FrontBrakeCompound),
        ("Physics", "rearBrakeCompound", b => Physics(b).RearBrakeCompound),
        ("Physics", "padLife", b => Physics(b).PadLife),
        ("Physics", "discLife", b => Physics(b).DiscLife),
        ("Physics", "ignitionOn", b => Physics(b).IgnitionOn),
        ("Physics", "starterEngineOn", b => Physics(b).StarterEngineOn),
        ("Physics", "isEngineRunning", b => Physics(b).IsEngineRunning),

        ("Graphics", "packetId", b => Graphics(b).PacketId),
        ("Graphics", "status", b => Graphics(b).Status),
        ("Graphics", "session", b => Graphics(b).Session),
        ("Graphics", "completedLaps", b => Graphics(b).CompletedLaps),
        ("Graphics", "position", b => Graphics(b).Position),
        ("Graphics", "iCurrentTime", b => Graphics(b).CurrentTimeMs),
        ("Graphics", "iLastTime", b => Graphics(b).LastTimeMs),
        ("Graphics", "iBestTime", b => Graphics(b).BestTimeMs),
        ("Graphics", "sessionTimeLeft", b => Graphics(b).SessionTimeLeft),
        ("Graphics", "distanceTraveled", b => Graphics(b).DistanceTraveled),
        ("Graphics", "isInPit", b => Graphics(b).IsInPit),
        ("Graphics", "currentSectorIndex", b => Graphics(b).CurrentSectorIndex),
        ("Graphics", "lastSectorTime", b => Graphics(b).LastSectorTimeMs),
        ("Graphics", "numberOfLaps", b => Graphics(b).NumberOfLaps),
        ("Graphics", "tyreCompound", b => Graphics(b).TyreCompound),
        ("Graphics", "normalizedCarPosition", b => Graphics(b).NormalizedCarPosition),
        ("Graphics", "activeCars", b => Graphics(b).ActiveCars),
        ("Graphics", "playerCarID", b => Graphics(b).PlayerCarId),
        ("Graphics", "penaltyTime", b => Graphics(b).PenaltyTime),
        ("Graphics", "flag", b => Graphics(b).Flag),
        ("Graphics", "penalty", b => Graphics(b).Penalty),
        ("Graphics", "isInPitLane", b => Graphics(b).IsInPitLane),
        ("Graphics", "surfaceGrip", b => Graphics(b).SurfaceGrip),
        ("Graphics", "mandatoryPitDone", b => Graphics(b).MandatoryPitDone),
        ("Graphics", "windSpeed", b => Graphics(b).WindSpeed),
        ("Graphics", "windDirection", b => Graphics(b).WindDirection),
        ("Graphics", "isSetupMenuVisible", b => Graphics(b).IsSetupMenuVisible),
        ("Graphics", "TC", b => Graphics(b).TcLevel),
        ("Graphics", "TCCUT", b => Graphics(b).TcCutLevel),
        ("Graphics", "EngineMap", b => Graphics(b).EngineMap),
        ("Graphics", "ABS", b => Graphics(b).AbsLevel),
        ("Graphics", "fuelXLap", b => Graphics(b).FuelPerLap),
        ("Graphics", "rainTyres", b => Graphics(b).RainTyres),
        ("Graphics", "sessionIndex", b => Graphics(b).SessionIndex),
        ("Graphics", "usedFuel", b => Graphics(b).UsedFuel),
        ("Graphics", "iDeltaLapTime", b => Graphics(b).DeltaLapTimeMs),
        ("Graphics", "iEstimatedLapTime", b => Graphics(b).EstimatedLapTimeMs),
        ("Graphics", "iSplit", b => Graphics(b).SplitMs),
        ("Graphics", "isValidLap", b => Graphics(b).IsValidLap),
        ("Graphics", "fuelEstimatedLaps", b => Graphics(b).FuelEstimatedLaps),
        ("Graphics", "trackStatus", b => Graphics(b).TrackStatus),
        ("Graphics", "missingMandatoryPits", b => Graphics(b).MissingMandatoryPits),
        ("Graphics", "Clock", b => Graphics(b).Clock),
        ("Graphics", "GlobalYellow", b => Graphics(b).GlobalYellow),
        ("Graphics", "GlobalWhite", b => Graphics(b).GlobalWhite),
        ("Graphics", "GlobalGreen", b => Graphics(b).GlobalGreen),
        ("Graphics", "GlobalChequered", b => Graphics(b).GlobalChequered),
        ("Graphics", "GlobalRed", b => Graphics(b).GlobalRed),
        ("Graphics", "trackGripStatus", b => Graphics(b).TrackGripStatus),
        ("Graphics", "rainIntensity", b => Graphics(b).RainIntensity),
        ("Graphics", "rainIntensityIn10min", b => Graphics(b).RainIntensityIn10Min),
        ("Graphics", "rainIntensityIn30min", b => Graphics(b).RainIntensityIn30Min),
        ("Graphics", "gapAhead", b => Graphics(b).GapAheadMs),
        ("Graphics", "gapBehind", b => Graphics(b).GapBehindMs),

        ("Static", "smVersion", b => Static(b).SmVersion),
        ("Static", "acVersion", b => Static(b).AcVersion),
        ("Static", "numberOfSessions", b => Static(b).NumberOfSessions),
        ("Static", "numCars", b => Static(b).NumCars),
        ("Static", "carModel", b => Static(b).CarModel),
        ("Static", "track", b => Static(b).Track),
        ("Static", "playerName", b => Static(b).PlayerName),
        ("Static", "playerSurname", b => Static(b).PlayerSurname),
        ("Static", "playerNick", b => Static(b).PlayerNick),
        ("Static", "sectorCount", b => Static(b).SectorCount),
        ("Static", "maxRpm", b => Static(b).MaxRpm),
        ("Static", "maxFuel", b => Static(b).MaxFuel),
        ("Static", "penaltiesEnabled", b => Static(b).PenaltiesEnabled),
        ("Static", "PitWindowStart", b => Static(b).PitWindowStart),
        ("Static", "PitWindowEnd", b => Static(b).PitWindowEnd),
        ("Static", "isOnline", b => Static(b).IsOnline),
        ("Static", "dryTyresName", b => Static(b).DryTyresName),
        ("Static", "wetTyresName", b => Static(b).WetTyresName),
    ];

    public static TheoryData<string, string> MappedFields()
    {
        var data = new TheoryData<string, string>();
        foreach (var (page, field, _) in Mapped)
            data.Add(page, field);
        return data;
    }

    [Theory]
    [InlineData("Physics", AccSharedMemory.PhysicsSize)]
    [InlineData("Graphics", AccSharedMemory.GraphicsSize)]
    [InlineData("Static", AccSharedMemory.StaticSize)]
    public void Page_sizes_are_the_documents_fields_laid_out_in_order(string page, int size) =>
        Assert.Equal(size, Layout(Fields(page)).Size);

    // Each field alone in an otherwise empty page, so reading from anywhere else gives 0, false or "" and fails
    [Theory]
    [MemberData(nameof(MappedFields))]
    public void Each_field_is_read_from_where_the_document_puts_it(string page, string field)
    {
        var read = Mapped.Single(m => m.Page == page && m.Field == field).Read;
        var fields = Fields(page);
        var documented = fields.Single(f => f.Name == field);

        var empty = Build(fields, _ => false);
        var marked = Build(fields, f => f.Name == field);
        Assert.Equal(Normalize(read(empty)), Zero(documented, read(empty)));
        Assert.Equal(Marker(documented, read(marked)), Normalize(read(marked)));
    }

    // Every field filled at once, as in the game: catches a read that overlaps its neighbor
    [Fact]
    public void Full_pages_read_back_every_field()
    {
        foreach (var page in new[] { "Physics", "Graphics", "Static" })
        {
            var fields = Fields(page);
            var bytes = Build(fields, _ => true);
            foreach (var (p, field, read) in Mapped.Where(m => m.Page == page))
            {
                var value = read(bytes);
                Assert.True(Equals(Marker(fields.Single(f => f.Name == field), value), Normalize(value)), $"{p}.{field}");
            }
        }
    }

    [Fact]
    public void The_parser_reads_every_field_the_document_marks_as_working_and_more_than_none()
    {
        // Fields left out on purpose: marked not used, or read by PlayerCoordinates, or not needed (strings that
        // duplicate an i* field, the MFD and per-sector flags). A new document field fails this until it's decided.
        string[] leftOut =
        [
            "wheelLoad", "tyreWear", "tyreDirtyLevel", "camberRAD", "drs", "cgHeight", "numberOfTyresOut", "kersCharge", "kersInput",
            "rideHeight", "ballast", "airDensity", "performanceMeter", "engineBrake", "ersRecoveryLevel", "ersPowerLevel", "ersHeatCharging",
            "ersIsCharging", "kersCurrentKJ", "drsAvailable", "drsEnabled", "tyreTempI", "tyreTempM", "tyreTempO", "tyreContactPoint",
            "tyreContactNormal", "tyreContactHeading", "P2PActivation", "P2PStatus", "currentMaxRpm", "mz", "fx", "fy", "tcinAction",
            "absInAction", "suspensionDamage", "tyreTemp", "kerbVibration", "slipVibrations", "gVibrations", "absVibrations",
            "currentTime", "lastTime", "bestTime", "split", "replayTimeMultiplier", "carCoordinates", "carID", "idealLineOn",
            "mainDisplayIndex", "secondaryDisplyIndex", "rainLights", "flashingLights", "lightsStage", "exhaustTemperature", "wiperLV",
            "driverStintTotalTimeLeft", "driverStintTimeLeft", "deltaLapTime", "estimatedLapTime", "isDeltaPositive", "directionLightsLeft",
            "directionLightsRight", "GlobalYellow1", "GlobalYellow2", "GlobalYellow3", "mfdTyreSet", "mfdFuelToAdd", "mfdTyrePressureLF",
            "mfdTyrePressureRF", "mfdTyrePressureLR", "mfdTyrePressureRR", "currentTyreSet", "strategyTyreSet",
            "maxTorque", "maxPower", "suspensionMaxTravel", "tyreRadius", "maxTurboBoost", "deprecated_1", "deprecated_2", "aidFuelRate",
            "aidTireRate", "aidMechanicalDamage", "AllowTyreBlankets", "aidStability", "aidAutoclutch", "aidAutoBlip", "hasDRS", "hasERS",
            "hasKERS", "kersMaxJ", "engineBrakeSettingsCount", "ersPowerControllerCount", "trackSplineLength", "trackConfiguration",
            "ersMaxJ", "isTimedRace", "hasExtraLap", "carSkin", "reversedGridPositions",
        ];
        foreach (var page in new[] { "Physics", "Graphics", "Static" })
        foreach (var field in Fields(page))
            Assert.True(Mapped.Any(m => m.Page == page && m.Field == field.Name) || leftOut.Contains(field.Name), $"{page}.{field.Name} is neither read nor left out on purpose");
    }

    [Fact]
    public void The_players_coordinates_are_found_by_their_car_id()
    {
        var fields = AccDocumentedLayout.Graphics;
        var (offsets, _) = Layout(fields);
        var bytes = new byte[AccSharedMemory.GraphicsSize];
        BinaryPrimitives.WriteInt32LittleEndian(bytes.AsSpan(offsets["activeCars"]), 3);
        BinaryPrimitives.WriteInt32LittleEndian(bytes.AsSpan(offsets["playerCarID"]), 1007);
        int[] ids = [1003, 1007, 1012];
        for (var i = 0; i < ids.Length; i++)
        {
            BinaryPrimitives.WriteInt32LittleEndian(bytes.AsSpan(offsets["carID"] + 4 * i), ids[i]);
            for (var axis = 0; axis < 3; axis++)
                BinaryPrimitives.WriteSingleLittleEndian(bytes.AsSpan(offsets["carCoordinates"] + 12 * i + 4 * axis), 10 * i + axis);
        }

        Assert.Equal(new Vector3(10, 11, 12), AccSharedMemory.ReadGraphics(bytes).PlayerCoordinates);

        BinaryPrimitives.WriteInt32LittleEndian(bytes.AsSpan(offsets["playerCarID"]), 999); // not on track
        Assert.Null(AccSharedMemory.ReadGraphics(bytes).PlayerCoordinates);
        BinaryPrimitives.WriteInt32LittleEndian(bytes.AsSpan(offsets["activeCars"]), 500); // nonsense count: stays inside the array
        Assert.Null(AccSharedMemory.ReadGraphics(bytes).PlayerCoordinates);
    }

    [Fact]
    public void Strings_end_at_the_first_nul_or_fill_the_array()
    {
        var fields = AccDocumentedLayout.Static;
        var (offsets, _) = Layout(fields);
        var bytes = new byte[AccSharedMemory.StaticSize];
        Encoding.Unicode.GetBytes("Spa\0junk").CopyTo(bytes, offsets["track"]);
        var full = new string('x', 33); // no NUL: the whole array, and nothing from the next field
        Encoding.Unicode.GetBytes(full).CopyTo(bytes, offsets["playerName"]);
        Encoding.Unicode.GetBytes("Lutz").CopyTo(bytes, offsets["playerSurname"]);
        Encoding.Unicode.GetBytes("Ünïcødé").CopyTo(bytes, offsets["playerNick"]);

        var page = AccSharedMemory.ReadStatic(bytes);
        Assert.Equal("Spa", page.Track);
        Assert.Equal(full, page.PlayerName);
        Assert.Equal("Lutz", page.PlayerSurname);
        Assert.Equal("Ünïcødé", page.PlayerNick);
    }

    [Fact]
    public void A_short_page_is_refused_rather_than_read_past()
    {
        Assert.Throws<ArgumentException>(() => AccSharedMemory.ReadPhysics(new byte[AccSharedMemory.PhysicsSize - 1]));
        Assert.Throws<ArgumentException>(() => AccSharedMemory.ReadGraphics(new byte[AccSharedMemory.GraphicsSize - 1]));
        Assert.Throws<ArgumentException>(() => AccSharedMemory.ReadStatic(new byte[AccSharedMemory.StaticSize - 1]));
        // A newer version could make a page longer: the documented part still reads
        Assert.Equal(0, AccSharedMemory.ReadPhysics(new byte[AccSharedMemory.PhysicsSize + 64]).PacketId);
    }

    [Fact]
    public void Cars_are_found_by_their_kunos_id()
    {
        var porsche = AccCars.Find("porsche_991ii_gt3_r");
        Assert.NotNull(porsche);
        Assert.Equal("Porsche 911 II GT3 R 2019", porsche.Name);
        Assert.Equal(400, porsche.MaxSteeringAngleDegrees);
        Assert.Equal(9250, porsche.MaxRpm);
        Assert.Same(porsche, AccCars.Find(" PORSCHE_991II_GT3_R "));
        Assert.Null(AccCars.Find("porsche_992_gt3_r")); // 2023, after the document
        Assert.Null(AccCars.Find(null));
        Assert.Equal(AccCars.All.Count, AccCars.All.Select(c => c.KunosId).Distinct().Count());
        Assert.Equal(AccCars.All.Count, AccCars.All.Select(c => c.CarModelId).Distinct().Count());
    }

    private static AccPhysics Physics(byte[] b) => AccSharedMemory.ReadPhysics(b);
    private static AccGraphics Graphics(byte[] b) => AccSharedMemory.ReadGraphics(b);
    private static AccStatic Static(byte[] b) => AccSharedMemory.ReadStatic(b);

    private static DocumentedField[] Fields(string page) => page switch
    {
        "Physics" => AccDocumentedLayout.Physics,
        "Graphics" => AccDocumentedLayout.Graphics,
        "Static" => AccDocumentedLayout.Static,
        _ => throw new ArgumentException(page),
    };
}
