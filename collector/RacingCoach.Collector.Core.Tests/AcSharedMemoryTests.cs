using RacingCoach.Collector.Simulators;

namespace RacingCoach.Collector.Core.Tests;

using static DocumentedPages;

/// <summary>
/// Holds AcSharedMemory's offsets to Kunos's AC document: pages are built from the document's field list
/// (AcDocumentedLayout), laid out by its order and C's alignment, and read back through the parser. A field read from
/// the wrong place, or a size off by a padding, fails here. What the document can't settle (units, axes, signs) needs
/// a recording from the game.
/// </summary>
public sealed class AcSharedMemoryTests
{
    private static readonly (string Page, string Field, Func<byte[], object> Read)[] Mapped =
    [
        ("Physics", "packetId", b => Physics(b).PacketId),
        ("Physics", "gas", b => Physics(b).Gas),
        ("Physics", "brake", b => Physics(b).Brake),
        ("Physics", "fuel", b => Physics(b).Fuel),
        ("Physics", "gear", b => Physics(b).Gear),
        ("Physics", "rpms", b => Physics(b).Rpm),
        ("Physics", "steerAngle", b => Physics(b).SteerAngle),
        ("Physics", "speedKmh", b => Physics(b).SpeedKmh),
        ("Physics", "velocity", b => Physics(b).Velocity),
        ("Physics", "accG", b => Physics(b).AccG),
        ("Physics", "wheelSlip", b => Physics(b).WheelSlip),
        ("Physics", "wheelLoad", b => Physics(b).WheelLoad),
        ("Physics", "wheelsPressure", b => Physics(b).WheelsPressure),
        ("Physics", "wheelAngularSpeed", b => Physics(b).WheelAngularSpeed),
        ("Physics", "tyreWear", b => Physics(b).TyreWear),
        ("Physics", "tyreDirtyLevel", b => Physics(b).TyreDirtyLevel),
        ("Physics", "tyreCoreTemperature", b => Physics(b).TyreCoreTemperature),
        ("Physics", "camberRAD", b => Physics(b).CamberRad),
        ("Physics", "suspensionTravel", b => Physics(b).SuspensionTravel),
        ("Physics", "drs", b => Physics(b).Drs),
        ("Physics", "tc", b => Physics(b).Tc),
        ("Physics", "heading", b => Physics(b).Heading),
        ("Physics", "pitch", b => Physics(b).Pitch),
        ("Physics", "roll", b => Physics(b).Roll),
        ("Physics", "cgHeight", b => Physics(b).CgHeight),
        ("Physics", "carDamage", b => Physics(b).CarDamage),
        ("Physics", "numberOfTyresOut", b => Physics(b).NumberOfTyresOut),
        ("Physics", "pitLimiterOn", b => Physics(b).PitLimiterOn),
        ("Physics", "abs", b => Physics(b).Abs),
        ("Physics", "autoShifterOn", b => Physics(b).AutoShifterOn),
        ("Physics", "rideHeight", b => new[] { Physics(b).RideHeightFront, Physics(b).RideHeightRear }),
        ("Physics", "turboBoost", b => Physics(b).TurboBoost),
        ("Physics", "airTemp", b => Physics(b).AirTemp),
        ("Physics", "roadTemp", b => Physics(b).RoadTemp),
        ("Physics", "localAngularVel", b => Physics(b).LocalAngularVelocity),
        ("Physics", "finalFF", b => Physics(b).FinalFf),
        ("Physics", "brakeTemp", b => Physics(b).BrakeTemp),
        ("Physics", "clutch", b => Physics(b).Clutch),
        ("Physics", "tyreTempI", b => Physics(b).TyreTempInner),
        ("Physics", "tyreTempM", b => Physics(b).TyreTempMiddle),
        ("Physics", "tyreTempO", b => Physics(b).TyreTempOuter),
        ("Physics", "isAIControlled", b => Physics(b).IsAiControlled),
        ("Physics", "brakeBias", b => Physics(b).BrakeBias),
        ("Physics", "localVelocity", b => Physics(b).LocalVelocity),

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
        ("Graphics", "replayTimeMultiplier", b => Graphics(b).ReplayTimeMultiplier),
        ("Graphics", "normalizedCarPosition", b => Graphics(b).NormalizedCarPosition),
        ("Graphics", "carCoordinates", b => Graphics(b).CarCoordinates),
        ("Graphics", "penaltyTime", b => Graphics(b).PenaltyTime),
        ("Graphics", "flag", b => Graphics(b).Flag),
        ("Graphics", "isInPitLane", b => Graphics(b).IsInPitLane),
        ("Graphics", "surfaceGrip", b => Graphics(b).SurfaceGrip),
        ("Graphics", "mandatoryPitDone", b => Graphics(b).MandatoryPitDone),
        ("Graphics", "windSpeed", b => Graphics(b).WindSpeed),
        ("Graphics", "windDirection", b => Graphics(b).WindDirection),

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
        ("Static", "maxTorque", b => Static(b).MaxTorque),
        ("Static", "maxPower", b => Static(b).MaxPower),
        ("Static", "maxRpm", b => Static(b).MaxRpm),
        ("Static", "maxFuel", b => Static(b).MaxFuel),
        ("Static", "suspensionMaxTravel", b => Static(b).SuspensionMaxTravel),
        ("Static", "tyreRadius", b => Static(b).TyreRadius),
        ("Static", "penaltiesEnabled", b => Static(b).PenaltiesEnabled),
        ("Static", "aidAutoClutch", b => Static(b).AidAutoClutch),
        ("Static", "trackSPlineLength", b => Static(b).TrackSplineLength),
        ("Static", "trackConfiguration", b => Static(b).TrackConfiguration),
        ("Static", "isTimedRace", b => Static(b).IsTimedRace),
        ("Static", "carSkin", b => Static(b).CarSkin),
        ("Static", "PitWindowStart", b => Static(b).PitWindowStart),
        ("Static", "PitWindowEnd", b => Static(b).PitWindowEnd),
    ];

    public static TheoryData<string, string> MappedFields()
    {
        var data = new TheoryData<string, string>();
        foreach (var (page, field, _) in Mapped)
            data.Add(page, field);
        return data;
    }

    [Theory]
    [InlineData("Physics", AcSharedMemory.PhysicsSize)]
    [InlineData("Graphics", AcSharedMemory.GraphicsSize)]
    [InlineData("Static", AcSharedMemory.StaticSize)]
    public void Page_sizes_are_the_documents_fields_laid_out_in_order(string page, int size) =>
        Assert.Equal(size, Layout(Fields(page)).Size);

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
    public void Every_documented_field_is_read_or_left_out_on_purpose()
    {
        // Not needed for laps or their checking: strings that duplicate an i* field, KERS/ERS/DRS, aids, and the tyre
        // contact vectors. A raw recording keeps them all anyway.
        string[] leftOut =
        [
            "kersCharge", "kersInput", "ballast", "airDensity", "performanceMeter", "engineBrake", "ersRecoveryLevel",
            "ersPowerLevel", "ersHeatCharging", "ersIsCharging", "kersCurrentKJ", "drsAvailable", "drsEnabled",
            "tyreContactPoint", "tyreContactNormal", "tyreContactHeading",
            "currentTime", "lastTime", "bestTime", "split", "idealLineOn",
            "maxTurboBoost", "deprecated_1", "deprecated_2", "aidFuelRate", "aidTireRate", "aidMechanicalDamage",
            "aidAllowTyreBlankets", "aidStability", "aidAutoBlip", "hasDRS", "hasERS", "hasKERS", "kersMaxJ",
            "engineBrakeSettingsCount", "ersPowerControllerCount", "ersMaxJ", "hasExtraLap", "reversedGridPositions",
        ];
        foreach (var page in new[] { "Physics", "Graphics", "Static" })
        foreach (var field in Fields(page))
            Assert.True(Mapped.Any(m => m.Page == page && m.Field == field.Name) || leftOut.Contains(field.Name), $"{page}.{field.Name} is neither read nor left out on purpose");
    }

    [Fact]
    public void Fields_both_games_have_sit_where_accs_do()
    {
        // ACC's pages grew from AC's, keeping its fields' places: a cross-check of two documents, not of either parser
        var (ac, _) = Layout(AcDocumentedLayout.Physics);
        var (acc, _) = Layout(AccDocumentedLayout.Physics);
        foreach (var name in new[] { "steerAngle", "accG", "heading", "localAngularVel", "clutch", "brakeBias", "localVelocity" })
            Assert.Equal(acc[name], ac[name]);
        Assert.Equal(Layout(AccDocumentedLayout.Graphics).Offsets["normalizedCarPosition"], Layout(AcDocumentedLayout.Graphics).Offsets["normalizedCarPosition"]);
        Assert.Equal(Layout(AccDocumentedLayout.Static).Offsets["PitWindowEnd"], Layout(AcDocumentedLayout.Static).Offsets["PitWindowEnd"]);
    }

    [Fact]
    public void A_short_page_is_refused_and_a_longer_one_read()
    {
        Assert.Throws<ArgumentException>(() => AcSharedMemory.ReadPhysics(new byte[AcSharedMemory.PhysicsSize - 1]));
        Assert.Throws<ArgumentException>(() => AcSharedMemory.ReadGraphics(new byte[AcSharedMemory.GraphicsSize - 1]));
        Assert.Throws<ArgumentException>(() => AcSharedMemory.ReadStatic(new byte[AcSharedMemory.StaticSize - 1]));
        // The adapter's raw recordings keep more than the documented page
        Assert.Equal(0, AcSharedMemory.ReadPhysics(new byte[2048]).PacketId);
    }

    private static AcPhysics Physics(byte[] b) => AcSharedMemory.ReadPhysics(b);
    private static AcGraphics Graphics(byte[] b) => AcSharedMemory.ReadGraphics(b);
    private static AcStatic Static(byte[] b) => AcSharedMemory.ReadStatic(b);

    private static DocumentedField[] Fields(string page) => page switch
    {
        "Physics" => AcDocumentedLayout.Physics,
        "Graphics" => AcDocumentedLayout.Graphics,
        "Static" => AcDocumentedLayout.Static,
        _ => throw new ArgumentException(page),
    };
}
