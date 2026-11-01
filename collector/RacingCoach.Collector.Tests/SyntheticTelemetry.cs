using System.Text;
using SVappsLAB.iRacingTelemetrySDK;

namespace RacingCoach.Collector.Tests;

/// <summary>
/// Deterministic iRacing telemetry for tests: not recorded from the sim, but every saved variable has its real name,
/// type and unit. Laps take LapSeconds at 60 Hz, with values that differ per sample and per variable so that a column
/// swapped, dropped, rounded or read from the wrong sample changes the CSV's hash.
/// </summary>
internal static class SyntheticTelemetry
{
    public const int Hz = 60;
    public const double LapSeconds = 20;

    /// <summary>The sample at a tick: LapDistPct runs 0-1 over each lap, starting just before the line.</summary>
    public static TelemetryData Sample(int tick, int sessionNum = 0, int startOffsetTicks = 30)
    {
        var total = (tick + (LapSeconds * Hz) - startOffsetTicks) / (LapSeconds * Hz);
        var lap = (int)Math.Floor(total);
        var pct = (float)(total - lap);
        var w = tick / 97.0;
        float V(double scale, double phase) => (float)Math.Round(scale * Math.Sin(w + phase), 4);
        return new TelemetryData
        {
            Speed = 40 + V(25, 0),
            LapDistPct = pct,
            Brake = Math.Max(0, V(1, 1)),
            Throttle = Math.Max(0, V(1, 2)),
            RPM = 6000 + V(1500, 3),
            SteeringWheelAngle = V(1.2f, 4),
            Gear = 3 + (int)Math.Round(1.5 * Math.Sin(w)),
            Clutch = 1,
            BrakeABSactive = tick % 300 < 10,
            LatAccel = V(20, 5),
            LongAccel = V(12, 6),
            VertAccel = 9.81f + V(2, 7),
            Yaw = V(3, 8),
            YawRate = V(0.9f, 9),
            VelocityX = 40 + V(25, 0),
            VelocityY = V(1.5f, 10),
            LFtempCL = 80 + V(5, 11), LFtempCM = 81 + V(5, 12), LFtempCR = 82 + V(5, 13),
            RFtempCL = 83 + V(5, 14), RFtempCM = 84 + V(5, 15), RFtempCR = 85 + V(5, 16),
            LRtempCL = 86 + V(5, 17), LRtempCM = 87 + V(5, 18), LRtempCR = 88 + V(5, 19),
            RRtempCL = 89 + V(5, 20), RRtempCM = 90 + V(5, 21), RRtempCR = 91 + V(5, 22),
            FuelLevel = 60 - tick * 0.001f,
            FuelUsePerHour = 70 + V(10, 23),
            WaterTemp = 90 + V(3, 24),
            OilTemp = 100 + V(3, 25),
            LFrideHeight = 0.05f + V(0.01f, 26), RFrideHeight = 0.05f + V(0.01f, 27),
            LRrideHeight = 0.06f + V(0.01f, 28), RRrideHeight = 0.06f + V(0.01f, 29),
            LFpressure = 170 + V(5, 30), RFpressure = 171 + V(5, 31), LRpressure = 172 + V(5, 32), RRpressure = 173 + V(5, 33),
            Lap = lap,
            LapDist = pct * 5000,
            SessionTime = tick / (double)Hz,
            SessionTick = tick,
            // Live laps have none of these until the session's .ibt file is read
            Lat = null,
            Lon = null,
            Alt = null,
            SessionNum = sessionNum,
            IsOnTrack = true,
            IsReplayPlaying = false,
            OnPitRoad = false,
            PlayerTrackSurface = TrackLocation.OnTrack,
            PlayerCarMyIncidentCount = 0,
            TrackTempCrew = 31.5f,
            AirTemp = 22.25f,
            RelativeHumidity = 0.45f,
            WindVel = 3.125f,
            WindDir = 1.5f,
        };
    }

    /// <summary>The variables of a synthetic .ibt file, with how to read each from a sample: real iRacing names and
    /// irsdk types (1 bool, 2 int, 4 float, 5 double).</summary>
    private static readonly (string Name, int Type, Func<TelemetryData, object?> Value)[] IbtVars =
    [
        ("Speed", 4, d => d.Speed), ("LapDistPct", 4, d => d.LapDistPct), ("Brake", 4, d => d.Brake), ("Throttle", 4, d => d.Throttle),
        ("RPM", 4, d => d.RPM), ("SteeringWheelAngle", 4, d => d.SteeringWheelAngle), ("Gear", 2, d => d.Gear), ("Clutch", 4, d => d.Clutch),
        ("BrakeABSactive", 1, d => d.BrakeABSactive), ("LatAccel", 4, d => d.LatAccel), ("LongAccel", 4, d => d.LongAccel), ("VertAccel", 4, d => d.VertAccel),
        ("Yaw", 4, d => d.Yaw), ("YawRate", 4, d => d.YawRate), ("VelocityX", 4, d => d.VelocityX), ("VelocityY", 4, d => d.VelocityY),
        ("LFtempCL", 4, d => d.LFtempCL), ("LFtempCM", 4, d => d.LFtempCM), ("LFtempCR", 4, d => d.LFtempCR),
        ("RFtempCL", 4, d => d.RFtempCL), ("RFtempCM", 4, d => d.RFtempCM), ("RFtempCR", 4, d => d.RFtempCR),
        ("LRtempCL", 4, d => d.LRtempCL), ("LRtempCM", 4, d => d.LRtempCM), ("LRtempCR", 4, d => d.LRtempCR),
        ("RRtempCL", 4, d => d.RRtempCL), ("RRtempCM", 4, d => d.RRtempCM), ("RRtempCR", 4, d => d.RRtempCR),
        ("FuelLevel", 4, d => d.FuelLevel), ("FuelUsePerHour", 4, d => d.FuelUsePerHour), ("WaterTemp", 4, d => d.WaterTemp), ("OilTemp", 4, d => d.OilTemp),
        ("LFrideHeight", 4, d => d.LFrideHeight), ("RFrideHeight", 4, d => d.RFrideHeight), ("LRrideHeight", 4, d => d.LRrideHeight), ("RRrideHeight", 4, d => d.RRrideHeight),
        ("LFpressure", 4, d => d.LFpressure), ("RFpressure", 4, d => d.RFpressure), ("LRpressure", 4, d => d.LRpressure), ("RRpressure", 4, d => d.RRpressure),
        ("Lap", 2, d => d.Lap), ("LapDist", 4, d => d.LapDist), ("SessionTime", 5, d => d.SessionTime), ("SessionTick", 2, d => d.SessionTick),
        ("SessionNum", 2, d => d.SessionNum), ("IsOnTrack", 1, d => d.IsOnTrack), ("IsReplayPlaying", 1, d => d.IsReplayPlaying), ("OnPitRoad", 1, d => d.OnPitRoad),
        ("PlayerTrackSurface", 2, d => (int?)d.PlayerTrackSurface), ("PlayerCarMyIncidentCount", 2, d => d.PlayerCarMyIncidentCount),
        ("TrackTempCrew", 4, d => d.TrackTempCrew), ("AirTemp", 4, d => d.AirTemp), ("RelativeHumidity", 4, d => d.RelativeHumidity),
        ("WindVel", 4, d => d.WindVel), ("WindDir", 4, d => d.WindDir),
        // A played-back .ibt's laps have positions straight away
        ("Lat", 5, d => 34.0 + (d.LapDistPct ?? 0) * 0.01), ("Lon", 5, d => -84.0 - (d.LapDistPct ?? 0) * 0.01), ("Alt", 4, d => 300 + (d.LapDistPct ?? 0) * 20),
    ];

    public const long IbtStartUnixSeconds = 4_102_444_800; // 2100-01-01: never past the collector's 90-day local deletion

    public const string SessionYaml = """
        ---
        WeekendInfo:
         TrackName: limerock full
         TrackDisplayName: Lime Rock Park
         TrackConfigName: Grand Prix
         TrackLength: 2.42 km
         TrackCity: Lakeville
         TrackCountry: USA
         TrackLatitude: 41.928 m
         TrackLongitude: -73.381 m
         TrackSkies: Partly Cloudy
         TrackWeatherType: Static
         SessionID: 111
         SubSessionID: 222
        SessionInfo:
         Sessions:
         - SessionNum: 0
           SessionType: Practice
           SessionName: PRACTICE
           SessionTrackRubberState: moderate usage
        DriverInfo:
         DriverCarIdx: 0
         DriverCarFuelKgPerLtr: 0.75
         Drivers:
         - CarIdx: 0
           UserName: Test Driver
           CarNumber: "7"
           CarPath: testcar
           CarScreenName: Test Car GT3
           CarScreenNameShort: Test Car
           CarClassShortName: GT3
           IRating: 1500
           LicString: A 4.0
        ...

        """;

    /// <summary>Writes a real .ibt file (irsdk header, disk header, variable headers, session info, then one record
    /// per sample), which the SDK plays back and IbtFile reads, as neither knows it wasn't iRacing that wrote it.</summary>
    public static void WriteIbt(string path, int ticks)
    {
        const int headerSize = 144, varHeaderSize = 144;
        var yaml = Encoding.UTF8.GetBytes(SessionYaml);
        var varHeaderOffset = headerSize;
        var sessionInfoOffset = varHeaderOffset + IbtVars.Length * varHeaderSize;
        var bufOffset = sessionInfoOffset + yaml.Length;

        var offsets = new int[IbtVars.Length];
        var bufLen = 0;
        for (var i = 0; i < IbtVars.Length; i++)
        {
            offsets[i] = bufLen;
            bufLen += IbtVars[i].Type switch { 1 => 1, 5 => 8, _ => 4 };
        }

        using var w = new BinaryWriter(File.Create(path));
        // irsdk_header
        w.Write(2); w.Write(1); w.Write(Hz); w.Write(0);
        w.Write(yaml.Length); w.Write(sessionInfoOffset);
        w.Write(IbtVars.Length); w.Write(varHeaderOffset);
        w.Write(1); w.Write(bufLen);
        w.Write(0); w.Write(0);
        w.Write(ticks); w.Write(bufOffset); w.Write(0); w.Write(0);
        w.Write(new byte[3 * 16]); // the other three varBufs, unused in a file
        // irsdk_diskSubHeader
        w.Write(IbtStartUnixSeconds); w.Write(0.0); w.Write(ticks / (double)Hz); w.Write(0); w.Write(ticks);

        for (var i = 0; i < IbtVars.Length; i++)
        {
            var (name, type, _) = IbtVars[i];
            w.Write(type); w.Write(offsets[i]); w.Write(1); w.Write(0);
            Fixed(w, name, 32);
            Fixed(w, "", 64);
            Fixed(w, "", 32);
        }
        w.Write(yaml);

        for (var tick = 0; tick < ticks; tick++)
        {
            var sample = Sample(tick);
            foreach (var (_, type, value) in IbtVars)
            {
                var v = value(sample);
                switch (type)
                {
                    case 1: w.Write(v is true); break;
                    case 2: w.Write(Convert.ToInt32(v ?? 0)); break;
                    case 4: w.Write(Convert.ToSingle(v ?? 0f)); break;
                    case 5: w.Write(Convert.ToDouble(v ?? 0.0)); break;
                }
            }
        }
    }

    private static void Fixed(BinaryWriter w, string text, int size)
    {
        var bytes = new byte[size];
        Encoding.ASCII.GetBytes(text, bytes);
        w.Write(bytes);
    }
}
