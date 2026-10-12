// ============================================================
// RACING TELEMETRY ENGINE
// ============================================================
//
// This file contains:
//
//   - Track / area lookup
//   - Shared telemetry utilities
//   - Shared crossing detection
//   - Corner timing
//   - Corner minimum speed
//   - Corner exit speed
//   - Shared area timing engine
//   - Lap brake point
//   - Fastest area brake point
//   - Area maximum brake pressure
//   - Area-based SimHub interface
//
// Track-specific configuration belongs in TrackConfig.js.
//
// ============================================================



// ============================================================
// CURRENT TELEMETRY
// ============================================================

function GetTelemetry()
{
    var telemetry =
    {
        pos: $prop('GameRawData.Telemetry.LapDistPct'),
        time: $prop('GameRawData.Telemetry.SessionTime'),
        speed: $prop('DataCorePlugin.GameData.NewData.SpeedLocal'),
        brake: $prop('GameRawData.Telemetry.Brake'),
        sessionID: $prop('GameRawData.Telemetry.SessionUniqueID'),
        trackName: $prop('TrackName'),
        trackLength: $prop('TrackLength')
    };

    UpdateLapState(telemetry);

    return telemetry;
}


// ============================================================
// SHARED LAP STATE
// ============================================================
//
// Single lap-state mechanism for the telemetry engine.
// It advances once per unique SessionTime sample so multiple
// dashboard functions can safely call GetTelemetry() against the
// same SimHub sample.
//
// ============================================================

function UpdateLapState(telemetry)
{
    if (telemetry == null ||
        telemetry.pos == null ||
        telemetry.time == null)
    {
        return;
    }

    var sessionKey = "TelemetryEngine_LapSession";
    var lapKey = "TelemetryEngine_Lap";
    var previousPosKey = "TelemetryEngine_LapPreviousPos";
    var currentPosKey = "TelemetryEngine_LapCurrentPos";
    var timeKey = "TelemetryEngine_LapTime";
    var newLapKey = "TelemetryEngine_NewLap";
    var lastSampleTimeKey = "TelemetryEngine_LapLastSampleTime";

    if (root[sessionKey] == null ||
        root[sessionKey] != telemetry.sessionID)
    {
        root[sessionKey] = telemetry.sessionID;
        root[lapKey] = 0;
        root[previousPosKey] = telemetry.pos;
        root[currentPosKey] = telemetry.pos;
        root[timeKey] = telemetry.time;
        root[newLapKey] = false;
        root[lastSampleTimeKey] = telemetry.time;
        return;
    }

    // Multiple SimHub bindings can evaluate the same telemetry sample.
    if (root[lastSampleTimeKey] == telemetry.time)
        return;

    var previousPos = root[currentPosKey];
    var currentPos = telemetry.pos;

    root[previousPosKey] = previousPos;
    root[currentPosKey] = currentPos;
    root[timeKey] = telemetry.time;
    root[newLapKey] = false;

    if (previousPos > 0.90 &&
        currentPos < 0.10)
    {
        root[lapKey] = root[lapKey] + 1;
        root[newLapKey] = true;
    }

    root[lastSampleTimeKey] = telemetry.time;
}


function GetLapState()
{
    return {
        lap: InitializeState("TelemetryEngine_Lap", 0),
        previousPos: InitializeState("TelemetryEngine_LapPreviousPos", 0),
        currentPos: InitializeState("TelemetryEngine_LapCurrentPos", 0),
        time: InitializeState("TelemetryEngine_LapTime", 0),
        newLap: InitializeState("TelemetryEngine_NewLap", false)
    };
}



// ============================================================
// TRACK LOOKUP
// ============================================================

function GetTrackConfig(trackName)
{
    if (trackName == null)
        return null;

    var name =
        String(trackName).toLowerCase();

    return TrackConfig[name] || null;
}



// ============================================================
// CURRENT TRACK NAME
// ============================================================
//
// SimHub provides the current iRacing track as TrackName.
//
// ============================================================

function GetCurrentTrackName()
{
    var trackName =
        $prop('TrackName');

    if (trackName == null)
        return "";

    return String(trackName);
}



// ============================================================
// AREA LOOKUP
// ============================================================

function GetArea(trackName, areaNumber)
{
    var track =
        GetTrackConfig(trackName);

    if (track == null)
        return null;

    if (track.areas == null)
        return null;

    var index =
        Number(areaNumber) - 1;

    if (index < 0 ||
        index >= track.areas.length)
    {
        return null;
    }

    return track.areas[index];
}



// ============================================================
// TRACK INFORMATION
// ============================================================

function GetTrackName(trackName)
{
    return trackName;
}


function GetTrackNotes(trackName)
{
    var track =
        GetTrackConfig(trackName);

    if (track == null)
        return "";

    return track.Notes || "";
}


function GetAreaCount(trackName)
{
    var track =
        GetTrackConfig(trackName);

    if (track == null ||
        track.areas == null)
    {
        return 0;
    }

    return track.areas.length;
}



// ============================================================
// AREA INFORMATION
// ============================================================

function GetAreaName(trackName, areaNumber)
{
    var area =
        GetArea(
            trackName,
            areaNumber
        );

    if (area == null)
        return "";

    return area.name || "";
}


function GetAreaStart(trackName, areaNumber)
{
    var area =
        GetArea(
            trackName,
            areaNumber
        );

    if (area == null)
        return 0;

    return area.start;
}


function GetAreaEnd(trackName, areaNumber)
{
    var area =
        GetArea(
            trackName,
            areaNumber
        );

    if (area == null)
        return 0;

    return area.end;
}


function GetAreaNotes(trackName, areaNumber)
{
    var area =
        GetArea(
            trackName,
            areaNumber
        );

    if (area == null)
        return "";

    return area.Notes || "";
}



// ============================================================
// AREA BRAKEPOINT TARGET
// ============================================================

function GetBrakepointTarget(areaNumber)
{
    var trackName =
        GetCurrentTrackName();


    var area =
        GetArea(
            trackName,
            areaNumber
        );


    if (area == null)
        return 0;


    return area.BrakepointTarget || 0;
}


// ============================================================
// AREA BRAKEPRESSURE TARGET
// ============================================================

function GetBrakePressureTarget(areaNumber)
{
    var trackName =
        GetCurrentTrackName();


    var area =
        GetArea(
            trackName,
            areaNumber
        );


    if (area == null)
        return 0;


    return area.MaxBrakeTarget || 0;
}


// ============================================================
// AREA THROTTLE PICKUP TARGET
// ============================================================

function GetThrottlePickupTarget(areaNumber)
{
    var trackName =
        GetCurrentTrackName();


    var area =
        GetArea(
            trackName,
            areaNumber
        );


    if (area == null)
        return 0;


    return area.ThrottlePickupTarget || 0;
}

// ============================================================
// PERSISTENT STATE HELPERS
// ============================================================

function InitializeState(key, defaultValue)
{
    if (root[key] == null)
        root[key] = defaultValue;

    return root[key];
}


function ResetState(key, value)
{
    root[key] = value;
}



// ============================================================
// STATE KEY
// ============================================================
//
// Creates a unique state prefix.
//
// Track name is included so identical area numbers/start/end
// combinations on different tracks cannot share state.
//
// ============================================================

function GetStatePrefix(
    type,
    name,
    startPoint,
    endPoint
)
{
    return type +
        "_" +
        name +
        "_" +
        startPoint +
        "_" +
        endPoint;
}



// ============================================================
// SESSION MANAGEMENT
// ============================================================

function IsNewSession(sessionKey, sessionID)
{
    if (sessionID == null)
        return false;

    if (root[sessionKey] == null)
    {
        root[sessionKey] =
            sessionID;

        return false;
    }

    if (root[sessionKey] != sessionID)
    {
        root[sessionKey] =
            sessionID;

        return true;
    }

    return false;
}



// ============================================================
// CROSSING TIME
// ============================================================
//
// Determines whether the car crossed a specified LapDistPct
// between the previous telemetry sample and the current one.
//
// Handles:
//
//   Normal forward movement
//   1.0 -> 0.0 lap wrap
//
// Returns:
//
//   Crossing time
//   null if the point was not crossed
//
// ============================================================

function GetCrossingTime(
    previousPos,
    currentPos,
    previousTime,
    currentTime,
    target
)
{
    var crossed =
        false;


    // --------------------------------------------------------
    // Normal forward movement
    // --------------------------------------------------------

    if (previousPos <= target &&
        currentPos >= target)
    {
        crossed = true;
    }


    // --------------------------------------------------------
    // Lap wrap: 1.0 -> 0.0
    // --------------------------------------------------------

    if (previousPos > 0.90 &&
        currentPos < 0.10)
    {
        if (target >= previousPos ||
            target <= currentPos)
        {
            crossed = true;
        }
    }


    if (!crossed)
        return null;


    // --------------------------------------------------------
    // Normal crossing
    // --------------------------------------------------------

    if (currentPos >= previousPos)
    {
        var distance =
            currentPos -
            previousPos;

        if (distance <= 0)
            return currentTime;

        var fraction =
            (target - previousPos) /
            distance;

        return previousTime +
            (
                (currentTime - previousTime) *
                fraction
            );
    }


    // --------------------------------------------------------
    // Crossing 1.0 -> 0.0
    // --------------------------------------------------------

    var wrappedDistance =
        (1.0 - previousPos) +
        currentPos;

    if (wrappedDistance <= 0)
        return currentTime;


    var targetDistance;


    if (target >= previousPos)
    {
        targetDistance =
            target -
            previousPos;
    }
    else
    {
        targetDistance =
            (1.0 - previousPos) +
            target;
    }


    var wrappedFraction =
        targetDistance /
        wrappedDistance;


    return previousTime +
        (
            (currentTime - previousTime) *
            wrappedFraction
        );
}



// ============================================================
// CORNER TIME
// ============================================================

function CornerTime(
    cornerName,
    startLapDistPct,
    endLapDistPct
)
{
    var telemetry =
        GetTelemetry();


    if (telemetry.pos == null ||
        telemetry.time == null)
    {
        return "0.00 s";
    }


    // --------------------------------------------------------
    // State keys
    // --------------------------------------------------------

    var prefix =
        GetStatePrefix(
            "CT",
            cornerName,
            startLapDistPct,
            endLapDistPct
        );


    var prevPosKey =
        prefix + "_PrevPos";

    var prevTimeKey =
        prefix + "_PrevTime";

    var startTimeKey =
        prefix + "_StartTime";

    var resultKey =
        prefix + "_Result";

    var bestKey =
        prefix + "_Best";

    var timingKey =
        prefix + "_Timing";

    var sessionKey =
        prefix + "_Session";


    // --------------------------------------------------------
    // Initialize
    // --------------------------------------------------------

    InitializeState(
        prevPosKey,
        telemetry.pos
    );

    InitializeState(
        prevTimeKey,
        telemetry.time
    );

    InitializeState(
        startTimeKey,
        0
    );

    InitializeState(
        resultKey,
        0
    );

    InitializeState(
        bestKey,
        0
    );

    InitializeState(
        timingKey,
        false
    );

    InitializeState(
        sessionKey,
        telemetry.sessionID
    );


    // --------------------------------------------------------
    // Detect new session
    // --------------------------------------------------------

    if (IsNewSession(
            sessionKey,
            telemetry.sessionID
        ))
    {
        ResetState(
            startTimeKey,
            0
        );

        ResetState(
            resultKey,
            0
        );

        ResetState(
            bestKey,
            0
        );

        ResetState(
            timingKey,
            false
        );
    }


    var previousPos =
        root[prevPosKey];

    var previousTime =
        root[prevTimeKey];


    // --------------------------------------------------------
    // Start timing
    // --------------------------------------------------------

    if (!root[timingKey])
    {
        var startCrossing =
            GetCrossingTime(
                previousPos,
                telemetry.pos,
                previousTime,
                telemetry.time,
                startLapDistPct
            );


        if (startCrossing != null)
        {
            root[startTimeKey] =
                startCrossing;

            root[timingKey] =
                true;
        }
    }


    // --------------------------------------------------------
    // End timing
    // --------------------------------------------------------

    if (root[timingKey])
    {
        var endCrossing =
            GetCrossingTime(
                previousPos,
                telemetry.pos,
                previousTime,
                telemetry.time,
                endLapDistPct
            );


        if (endCrossing != null)
        {
            var elapsed =
                endCrossing -
                root[startTimeKey];


            if (elapsed > 0 &&
                elapsed < 60)
            {
                root[resultKey] =
                    elapsed;


                if (root[bestKey] <= 0)
                {
                    root[bestKey] =
                        elapsed;
                }
                else if (elapsed < root[bestKey])
                {
                    root[bestKey] =
                        elapsed;
                }
            }


            root[timingKey] =
                false;
        }
    }


    // --------------------------------------------------------
    // Save telemetry
    // --------------------------------------------------------

    root[prevPosKey] =
        telemetry.pos;

    root[prevTimeKey] =
        telemetry.time;


    // --------------------------------------------------------
    // Calculate delta
    // --------------------------------------------------------

    var currentTime =
        root[resultKey];

    var bestTime =
        root[bestKey];


    var delta =
        currentTime -
        bestTime;


    // --------------------------------------------------------
    // Output
    // --------------------------------------------------------
   
    return cornerName +
        ": " +
        (delta >= 0 ? "+" : "") +
        format(
            delta,
            "0.00"
        ) +
        " s";

}



// ============================================================
// CORNER MINIMUM SPEED
// ============================================================

function CornerMinimumSpeed(
    cornerName,
    startLapDistPct,
    endLapDistPct
)
{
    var telemetry =
        GetTelemetry();


    if (telemetry.pos == null ||
        telemetry.time == null ||
        telemetry.speed == null)
    {
        return "0.0";
    }


    // --------------------------------------------------------
    // State keys
    // --------------------------------------------------------

    var prefix =
        GetStatePrefix(
            "CMS",
            cornerName,
            startLapDistPct,
            endLapDistPct
        );


    var prevPosKey =
        prefix + "_PrevPos";

    var prevTimeKey =
        prefix + "_PrevTime";

    var timingKey =
        prefix + "_Timing";

    var minSpeedKey =
        prefix + "_MinSpeed";

    var resultKey =
        prefix + "_Result";

    var sessionKey =
        prefix + "_Session";


    // --------------------------------------------------------
    // Initialize
    // --------------------------------------------------------

    InitializeState(
        prevPosKey,
        telemetry.pos
    );

    InitializeState(
        prevTimeKey,
        telemetry.time
    );

    InitializeState(
        timingKey,
        false
    );

    InitializeState(
        minSpeedKey,
        9999
    );

    InitializeState(
        resultKey,
        0
    );

    InitializeState(
        sessionKey,
        telemetry.sessionID
    );


    // --------------------------------------------------------
    // Detect new session
    // --------------------------------------------------------

    if (IsNewSession(
            sessionKey,
            telemetry.sessionID
        ))
    {
        ResetState(
            timingKey,
            false
        );

        ResetState(
            minSpeedKey,
            9999
        );

        ResetState(
            resultKey,
            0
        );
    }


    var previousPos =
        root[prevPosKey];

    var previousTime =
        root[prevTimeKey];


    // --------------------------------------------------------
    // Start minimum-speed tracking
    // --------------------------------------------------------

    if (!root[timingKey])
    {
        var startCrossing =
            GetCrossingTime(
                previousPos,
                telemetry.pos,
                previousTime,
                telemetry.time,
                startLapDistPct
            );


        if (startCrossing != null)
        {
            root[timingKey] =
                true;

            root[minSpeedKey] =
                telemetry.speed;
        }
    }


    // --------------------------------------------------------
    // Capture minimum speed
    // --------------------------------------------------------

    if (root[timingKey])
    {
        if (telemetry.speed <
            root[minSpeedKey])
        {
            root[minSpeedKey] =
                telemetry.speed;
        }
    }


    // --------------------------------------------------------
    // End minimum-speed tracking
    // --------------------------------------------------------

    if (root[timingKey])
    {
        var endCrossing =
            GetCrossingTime(
                previousPos,
                telemetry.pos,
                previousTime,
                telemetry.time,
                endLapDistPct
            );


        if (endCrossing != null)
        {
            root[resultKey] =
                root[minSpeedKey];

            root[timingKey] =
                false;

            root[minSpeedKey] =
                9999;
        }
    }


    // --------------------------------------------------------
    // Save telemetry
    // --------------------------------------------------------

    root[prevPosKey] =
        telemetry.pos;

    root[prevTimeKey] =
        telemetry.time;


    // --------------------------------------------------------
    // Output
    // --------------------------------------------------------

    return format(
        root[resultKey],
        "0.0"
    );
}



// ============================================================
// CORNER EXIT SPEED
// ============================================================

function CornerExitSpeed(
    cornerName,
    exitPoint
)
{
    var telemetry =
        GetTelemetry();


    if (telemetry.pos == null ||
        telemetry.speed == null)
    {
      //  return "0.0 mph";
return " ";
    }


    // --------------------------------------------------------
    // State keys
    // --------------------------------------------------------

    var prefix =
        "CES_" +
        cornerName +
        "_" +
        exitPoint;


    var speedKey =
        prefix + "_Speed";

    var bestKey =
        prefix + "_Best";

    var capturedKey =
        prefix + "_Captured";

    var lastLapKey =
        prefix + "_LastLap";

    var sessionKey =
        prefix + "_Session";


    // --------------------------------------------------------
    // Initialize
    // --------------------------------------------------------

    InitializeState(
        speedKey,
        0
    );

    InitializeState(
        bestKey,
        0
    );

    InitializeState(
        capturedKey,
        false
    );

    InitializeState(
        lastLapKey,
        GetLapState().lap
    );

    InitializeState(
        sessionKey,
        telemetry.sessionID
    );


    // --------------------------------------------------------
    // Detect new session
    // --------------------------------------------------------

    if (IsNewSession(
            sessionKey,
            telemetry.sessionID
        ))
    {
        ResetState(
            speedKey,
            0
        );

        ResetState(
            bestKey,
            0
        );

        ResetState(
            capturedKey,
            false
        );

        ResetState(
            lastLapKey,
            GetLapState().lap
        );
    }


    var lapState =
        GetLapState();


    // --------------------------------------------------------
    // Detect new lap using shared lap state
    // --------------------------------------------------------

    if (lapState.lap != root[lastLapKey])
    {
        root[capturedKey] =
            false;

        root[lastLapKey] =
            lapState.lap;
    }


    // --------------------------------------------------------
    // Capture exit speed
    // --------------------------------------------------------

    if (!root[capturedKey])
    {
        if (Math.abs(
                telemetry.pos -
                exitPoint
            ) <= 0.0006)
        {
            root[speedKey] =
                telemetry.speed;


            // Initial session best

            if (root[bestKey] == 0)
            {
                root[bestKey] =
                    telemetry.speed;
            }


            // New session best

            else if (
                telemetry.speed >
                root[bestKey]
            )
            {
                root[bestKey] =
                    telemetry.speed;
            }


            root[capturedKey] =
                true;
        }
    }


    // --------------------------------------------------------
    // Calculate delta
    // --------------------------------------------------------

if (root[bestKey]==0 || root[speedKey]==0) return " ";

    var delta =
        root[speedKey] -
        root[bestKey];

if (delta==0) return " ";

    // --------------------------------------------------------
    // Output
    // --------------------------------------------------------



   // return (delta >= 0 ? "-" : "") + format(delta,"0.0");
return (Math.round(delta * 10) / 10) + " mph";


}



// ============================================================
// SHARED AREA TIMING ENGINE
// ============================================================
//
// This is the central timing mechanism for all area-based
// calculations.
//
// It tracks:
//
//   - Area start crossing
//   - Area end crossing
//   - Current area time
//   - Current-lap brake point
//   - Session-best area time
//   - Brake point associated with session-best area time
//
// Brake point:
//
//   First telemetry sample inside the area where
//   brake pressure exceeds 1%.
//
// ============================================================

function ProcessArea(
    trackName,
    areaNumber,
    area
)
{
    var telemetry =
        GetTelemetry();


    if (telemetry.pos == null ||
        telemetry.time == null)
    {
        return {
            currentTime: 0,
            bestTime: 0,
            lapBrakePoint: 0,
            fastestBrakePoint: 0
        };
    }


    var prefix =
        GetStatePrefix(
            "AREA_" +
            String(trackName).toLowerCase() +
            "_A" +
            areaNumber,
            area.name,
            area.start,
            area.end
        );


    // --------------------------------------------------------
    // State keys
    // --------------------------------------------------------

    var prevPosKey =
        prefix + "_PrevPos";

    var prevTimeKey =
        prefix + "_PrevTime";

    var startTimeKey =
        prefix + "_StartTime";

    var timingKey =
        prefix + "_Timing";

    var currentTimeKey =
        prefix + "_CurrentTime";

    var bestTimeKey =
        prefix + "_BestTime";

    var brakePointKey =
        prefix + "_BrakePoint";

    var bestBrakePointKey =
        prefix + "_BestBrakePoint";

    var sessionKey =
        prefix + "_Session";


    // --------------------------------------------------------
    // Initialize
    // --------------------------------------------------------

    InitializeState(
        prevPosKey,
        telemetry.pos
    );

    InitializeState(
        prevTimeKey,
        telemetry.time
    );

    InitializeState(
        startTimeKey,
        0
    );

    InitializeState(
        timingKey,
        false
    );

    InitializeState(
        currentTimeKey,
        0
    );

    InitializeState(
        bestTimeKey,
        0
    );

    InitializeState(
        brakePointKey,
        0
    );

    InitializeState(
        bestBrakePointKey,
        0
    );

    InitializeState(
        sessionKey,
        telemetry.sessionID
    );


    // --------------------------------------------------------
    // Detect new session
    // --------------------------------------------------------

    if (IsNewSession(
            sessionKey,
            telemetry.sessionID
        ))
    {
        ResetState(
            startTimeKey,
            0
        );

        ResetState(
            timingKey,
            false
        );

        ResetState(
            currentTimeKey,
            0
        );

        ResetState(
            bestTimeKey,
            0
        );

        ResetState(
            brakePointKey,
            0
        );

        ResetState(
            bestBrakePointKey,
            0
        );
    }


    var previousPos =
        root[prevPosKey];

    var previousTime =
        root[prevTimeKey];


    // ========================================================
    // START OF AREA
    // ========================================================

    if (!root[timingKey])
    {
        var startCrossing =
            GetCrossingTime(
                previousPos,
                telemetry.pos,
                previousTime,
                telemetry.time,
                area.start
            );


        if (startCrossing != null)
        {
            root[startTimeKey] =
                startCrossing;

            root[timingKey] =
                true;

            // Reset current-lap brake point
            root[brakePointKey] =
                0;
        }
    }


    // ========================================================
    // INSIDE AREA
    // ========================================================

    if (root[timingKey])
    {
        // ----------------------------------------------------
        // Capture FIRST brake application over 1%
        // ----------------------------------------------------

        if (root[brakePointKey] == 0 &&
            telemetry.brake != null)
        {
            var brake =
                Number(telemetry.brake);

            if (!isNaN(brake) &&
                brake > 0.01)
            {
                root[brakePointKey] =
                    telemetry.pos;
            }
        }


        // ----------------------------------------------------
        // Detect area end
        // ----------------------------------------------------

        var endCrossing =
            GetCrossingTime(
                previousPos,
                telemetry.pos,
                previousTime,
                telemetry.time,
                area.end
            );


        if (endCrossing != null)
        {
            var elapsed =
                endCrossing -
                root[startTimeKey];


            // ------------------------------------------------
            // Accept valid area time
            // ------------------------------------------------

            if (elapsed > 0 &&
                elapsed < 60)
            {
                root[currentTimeKey] =
                    elapsed;


                // --------------------------------------------
                // Determine whether this is a new best
                // --------------------------------------------

                var isNewBest =
                    (
                        root[bestTimeKey] <= 0 ||
                        elapsed < root[bestTimeKey]
                    );


                if (isNewBest)
                {
                    root[bestTimeKey] =
                        elapsed;


                    // ----------------------------------------
                    // Save the brake point that produced
                    // this fastest area time.
                    // ----------------------------------------

                    root[bestBrakePointKey] =
                        root[brakePointKey];
                }
            }


            // ------------------------------------------------
            // Area complete
            // ------------------------------------------------

            root[timingKey] =
                false;
        }
    }


    // ========================================================
    // SAVE TELEMETRY
    // ========================================================

    root[prevPosKey] =
        telemetry.pos;

    root[prevTimeKey] =
        telemetry.time;


    // ========================================================
    // RETURN SHARED STATE
    // ========================================================

    return {
        currentTime:
            root[currentTimeKey],

        bestTime:
            root[bestTimeKey],

        lapBrakePoint:
            root[brakePointKey],

        fastestBrakePoint:
            root[bestBrakePointKey]
    };
}






// ============================================================
// LAP BRAKE POINT
// ============================================================
//
// Returns the brake point for the CURRENT LAP.
//
// Parameter:
//
//   areaNumber
//
// Example:
//
//   LapBrakePoint(2)
//
// Returns the LapDistPct where brake first exceeded 1%
// during Area 2.
//
// ============================================================

function LapBrakePoint(areaNumber)
{
    var telemetry =
        GetTelemetry();

    var trackName =
        telemetry.trackName;

   var trackLength = telemetry.trackLength;


    if (trackName == null ||
        trackName == "")
    {
        return 0;
    }


    var area =
        GetArea(
            trackName,
            areaNumber
        );


    if (area == null)
        return 0;


    var state =
        ProcessArea(
            trackName,
            areaNumber,
            area
        );


var feet = Math.round(state.lapBrakePoint * trackLength * 3.280839895);


   return feet;
}



// ============================================================
// FASTEST AREA BRAKE POINT
// ============================================================
//
// Returns the brake point associated with the FASTEST
// AreaTime achieved during the current session.
//
// Parameter:
//
//   areaNumber
//
// Example:
//
//   FastestAreaBrakePoint(2)
//
// The value only changes when Area 2 sets a new
// session-best area time.
//
// ============================================================

function FastestAreaBrakePoint(areaNumber)
{
    var telemetry = GetTelemetry();

    if (telemetry.pos == null ||
        telemetry.time == null)
    {
        return 0;
    }

    var trackName = telemetry.trackName;

    if (trackName == null ||
        trackName == "")
    {
        return 0;
    }

    var area = GetArea(
        trackName,
        areaNumber
    );

    if (area == null)
        return 0;


    // ========================================================
    // STATE
    // ========================================================

    var prefix =
        GetStatePrefix(
            "AREA_" +
            String(trackName).toLowerCase() +
            "_A" +
            areaNumber,
            area.name,
            area.start,
            area.end
        );

    var prevPosKey =
        prefix + "_PrevPos";

    var prevTimeKey =
        prefix + "_PrevTime";

    var startTimeKey =
        prefix + "_StartTime";

    var timingKey =
        prefix + "_Timing";

    var bestTimeKey =
        prefix + "_BestTime";

    var brakePointKey =
        prefix + "_BrakePoint";

    var bestBrakePointKey =
        prefix + "_BestBrakePoint";

    var sessionKey =
        prefix + "_Session";


    // ========================================================
    // INITIALIZE
    // ========================================================

    InitializeState(
        prevPosKey,
        telemetry.pos
    );

    InitializeState(
        prevTimeKey,
        telemetry.time
    );

    InitializeState(
        startTimeKey,
        0
    );

    InitializeState(
        timingKey,
        false
    );

    InitializeState(
        bestTimeKey,
        0
    );

    InitializeState(
        brakePointKey,
        0
    );

    InitializeState(
        bestBrakePointKey,
        0
    );

    InitializeState(
        sessionKey,
        telemetry.sessionID
    );


    // ========================================================
    // NEW SESSION
    // ========================================================

    if (IsNewSession(
            sessionKey,
            telemetry.sessionID))
    {
        ResetState(
            startTimeKey,
            0
        );

        ResetState(
            timingKey,
            false
        );

        ResetState(
            bestTimeKey,
            0
        );

        ResetState(
            brakePointKey,
            0
        );

        ResetState(
            bestBrakePointKey,
            0
        );
    }


    var previousPos =
        root[prevPosKey];

    var previousTime =
        root[prevTimeKey];


    // ========================================================
    // START OF AREA
    // ========================================================

    if (!root[timingKey])
    {
        var startCrossing =
            GetCrossingTime(
                previousPos,
                telemetry.pos,
                previousTime,
                telemetry.time,
                area.start
            );

        if (startCrossing != null)
        {
            root[startTimeKey] =
                startCrossing;

            root[timingKey] =
                true;

            root[brakePointKey] =
                0;
        }
    }


    // ========================================================
    // INSIDE AREA
    // ========================================================

    if (root[timingKey])
    {
        // ----------------------------------------------------
        // Capture first brake application greater than 1%
        // ----------------------------------------------------

        if (root[brakePointKey] == 0 &&
            telemetry.brake != null)
        {
            var brake =
                Number(telemetry.brake);

            if (!isNaN(brake) &&
                brake > 0.01)
            {
                root[brakePointKey] =
                    telemetry.pos;
            }
        }


        // ----------------------------------------------------
        // Detect end of area
        // ----------------------------------------------------

        var endCrossing =
            GetCrossingTime(
                previousPos,
                telemetry.pos,
                previousTime,
                telemetry.time,
                area.end
            );

        if (endCrossing != null)
        {
            var elapsed =
                endCrossing -
                root[startTimeKey];


            // ------------------------------------------------
            // Valid area time
            // ------------------------------------------------

            if (elapsed > 0 &&
                elapsed < 60)
            {
                var isNewBest =
                    (
                        root[bestTimeKey] <= 0 ||
                        elapsed < root[bestTimeKey]
                    );


                // --------------------------------------------
                // New fastest area
                // --------------------------------------------

                if (isNewBest)
                {
                    root[bestTimeKey] =
                        elapsed;

                    root[bestBrakePointKey] =
                        root[brakePointKey];
                }
            }


            root[timingKey] =
                false;
        }
    }


    // ========================================================
    // SAVE TELEMETRY
    // ========================================================

    root[prevPosKey] =
        telemetry.pos;

    root[prevTimeKey] =
        telemetry.time;


    // ========================================================
    // CONVERT FASTEST BRAKE POINT TO FEET
    // ========================================================

    var brakePoint =
        root[bestBrakePointKey];

    var trackLength =
        $prop('TrackLength');

    if (brakePoint <= 0 ||
        trackLength == null)
    {
        return 0;
    }


    var feet =
        Number(brakePoint) *
        Number(trackLength) *
        3.280839895;


    // ========================================================
    // RETURN LAST THREE DIGITS
    // ========================================================

  //  var lastThree = Math.floor(feet) % 1000;

    return Math.round(feet);
}



// ============================================================
// AREA CONTROL COASTING DISTANCE - logic changed
// ============================================================
//
// Returns the total distance in feet where BOTH:
// 
//   - Brake > 1%
//   - Throttle > 1%
//
// are inactive simultaneously inside the specified area.
//
// Multiple separate coasting periods within the same area are
// accumulated.
//
// ============================================================
function GetCoastingDistance(areaNumber)
{
    var telemetry =
        GetTelemetry();

    var throttle =
        $prop('GameRawData.Telemetry.Throttle');


    if (telemetry.pos == null ||
        telemetry.brake == null ||
        throttle == null ||
        telemetry.trackLength == null)
    {
        return 0;
    }


    var trackName =
        telemetry.trackName;


    if (trackName == null ||
        trackName == "")
    {
        return 0;
    }


    var area =
        GetArea(
            trackName,
            areaNumber
        );


    // Return a blank value when this focus area is not configured.
    if (area == null)
        return "";


    // ========================================================
    // STATE KEYS
    // ========================================================

    var prefix =
        GetStatePrefix(
            "COASTING_" +
            String(trackName).toLowerCase() +
            "_A" +
            areaNumber,
            area.name,
            area.start,
            area.end
        );


    var prevPosKey =
        prefix + "_PrevPos";

    var timingKey =
        prefix + "_Timing";

    var coastingDistanceKey =
        prefix + "_CoastingDistance";

    var sessionKey =
        prefix + "_Session";


    // ========================================================
    // INITIALIZE
    // ========================================================

    InitializeState(
        prevPosKey,
        telemetry.pos
    );

    InitializeState(
        timingKey,
        false
    );

    InitializeState(
        coastingDistanceKey,
        0
    );

    InitializeState(
        sessionKey,
        telemetry.sessionID
    );


    // ========================================================
    // NEW SESSION
    // ========================================================

    if (IsNewSession(
            sessionKey,
            telemetry.sessionID))
    {
        ResetState(
            timingKey,
            false
        );

        ResetState(
            coastingDistanceKey,
            0
        );

        ResetState(
            prevPosKey,
            telemetry.pos
        );
    }


    var previousPos =
        root[prevPosKey];


    // ========================================================
    // START OF AREA
    // ========================================================

    if (!root[timingKey])
    {
        var startCrossing =
            GetCrossingTime(
                previousPos,
                telemetry.pos,
                0,
                0,
                area.start
            );


        if (startCrossing != null)
        {
            ResetState(
                coastingDistanceKey,
                0
            );

            root[timingKey] =
                true;
        }
    }


    // ========================================================
    // INSIDE AREA
    // ========================================================

    if (root[timingKey])
    {
        var deltaPct =
            telemetry.pos -
            previousPos;


        // Handle lap wrap
        if (deltaPct < -0.5)
            deltaPct += 1.0;


        // Ignore invalid telemetry jumps
        if (deltaPct >= 0 &&
            deltaPct < 0.1)
        {
            // =================================================
            // BOTH BRAKE AND THROTTLE MUST BE < 1%
            // =================================================

            var brakeActive =
                Number(telemetry.brake) < 0.01;

            var throttleActive =
                Number(throttle) < 0.01;


            if (brakeActive &&
                throttleActive)
            {
                var distanceFeet =
                    deltaPct *
                    Number(telemetry.trackLength) *
                    3.280839895;


                root[coastingDistanceKey] +=
                    distanceFeet;
            }
        }


        // ====================================================
        // END OF AREA
        // ====================================================

        var endCrossing =
            GetCrossingTime(
                previousPos,
                telemetry.pos,
                0,
                0,
                area.end
            );


        if (endCrossing != null)
        {
            root[timingKey] =
                false;
        }
    }


    // ========================================================
    // SAVE TELEMETRY
    // ========================================================

    root[prevPosKey] =
        telemetry.pos;


    // ========================================================
    // RETURN DISTANCE IN FEET
    // ========================================================

    return Math.round(
        root[coastingDistanceKey]
    ) + " ft";
}


// ============================================================
// AREA TIME
// ============================================================
//
// Uses the SAME ProcessArea() state as:
//
//   LapBrakePoint()
//   FastestAreaBrakePoint()
//
// Therefore all three functions use the same:
//
//   - Start crossing
//   - End crossing
//   - Area time
//   - Session-best time
//   - Brake point
//
// ============================================================

function GetTimeArea(
    trackName,
    areaNumber
)
{
    var area =
        GetArea(
            trackName,
            areaNumber
        );


    // Return a blank value when this focus area is not configured.
    if (area == null)
        return "";


    var state =
        ProcessArea(
            trackName,
            areaNumber,
            area
        );


    var currentTime =
        state.currentTime;

    var bestTime =
        state.bestTime;


    var delta =
        currentTime -
        bestTime;

if (delta == 0) return "";

    return (delta >= 0 ? "+" : "") +
        format(
            delta,
            "0.00"
        ) +
        " s";
}



// ============================================================
// AREA EXIT SPEED
// ============================================================

function GetSpeedArea(
    trackName,
    areaNumber
)
{
    var area =
        GetArea(
            trackName,
            areaNumber
        );


    // Return a blank value when this focus area is not configured.
    if (area == null)
        return "";


    return CornerExitSpeed(
        area.name,
        area.end
    );
}



// ============================================================
// AREA MINIMUM SPEED
// ============================================================

function GetMinimumSpeedArea(
    trackName,
    areaNumber
)
{
    var area =
        GetArea(
            trackName,
            areaNumber
        );


    if (area == null)
        return "0.0";


    return CornerMinimumSpeed(
        area.name,
        area.start,
        area.end
    );
}


// ============================================================
// BRAKEPOINT / THROTTLE PICKUP ALERT COLOR
// ============================================================
//
// PHASE 1: BRAKEPOINT
//
//   > 400 ft before brakepoint : Transparent
//   301-400 ft                 : Gainsboro
//   201-300 ft                 : Orange
//   101-200 ft                 : SteelBlue
//   0-100 ft                   : Firebrick
//
// PHASE 2: THROTTLE PICKUP
//
//   > 200 ft before throttle   : Transparent
//   101-200 ft                 : Gainsboro
//   0-100 ft                   : Green
//   Target reached             : Transparent
//
// The throttle-pickup phase does NOT begin until the
// brakepoint target has been reached/crossed.
//
// ============================================================

function GetBrakepointAlertColor(areaNumber)
{
    var telemetry = GetTelemetry();

    if (telemetry.pos == null ||
        telemetry.trackLength == null ||
        telemetry.trackLength <= 0)
    {
        return "Transparent";
    }

    var trackFeet =
        Number(telemetry.trackLength) * 3.280839895;

    if (trackFeet <= 0)
        return "Transparent";


    // ========================================================
    // SHARED LAP STATE
    // ========================================================

    var lapState =
        GetLapState();


    // ========================================================
    // STATE KEYS
    // ========================================================

    var prefix =
        "BPA_" + areaNumber;

    var lastLapKey =
        prefix + "_LastLap";

    var brakepointReachedKey =
        prefix + "_BrakepointReached";

    var throttleReachedKey =
        prefix + "_ThrottleReached";


    // ========================================================
    // INITIALIZE STATE
    // ========================================================

    InitializeState(
        lastLapKey,
        lapState.lap
    );

    InitializeState(
        brakepointReachedKey,
        false
    );

    InitializeState(
        throttleReachedKey,
        false
    );


    // ========================================================
    // RESET ON NEW LAP
    // ========================================================

    if (root[lastLapKey] != lapState.lap)
    {
        root[lastLapKey] =
            lapState.lap;

        root[brakepointReachedKey] =
            false;

        root[throttleReachedKey] =
            false;
    }


    // ========================================================
    // --------------------------------------------------------
    // PHASE 1: BRAKEPOINT TARGET
    // --------------------------------------------------------
    // ========================================================

    if (!root[brakepointReachedKey])
    {
        var brakepointFeet =
            Number(GetBrakepointTarget(areaNumber));

        if (isNaN(brakepointFeet) ||
            brakepointFeet <= 0)
        {
            return "Transparent";
        }

        var brakepointPct =
            brakepointFeet / trackFeet;


        // ----------------------------------------------------
        // Detect brakepoint crossing
        // ----------------------------------------------------

        var brakepointCrossed =
            false;


        // Normal forward crossing
        if (lapState.previousPos <= brakepointPct &&
            lapState.currentPos >= brakepointPct)
        {
            brakepointCrossed =
                true;
        }

        // Start/finish wrap crossing
        else if (
            lapState.previousPos > 0.90 &&
            lapState.currentPos < 0.10 &&
            (
                brakepointPct >= lapState.previousPos ||
                brakepointPct <= lapState.currentPos
            )
        )
        {
            brakepointCrossed =
                true;
        }


        // ----------------------------------------------------
        // Brakepoint reached
        // ----------------------------------------------------

        if (brakepointCrossed)
        {
            root[brakepointReachedKey] =
                true;
        }
        else
        {
            // ------------------------------------------------
            // Calculate distance to brakepoint
            // ------------------------------------------------

            var brakepointDistancePct;

            if (brakepointPct >= telemetry.pos)
            {
                brakepointDistancePct =
                    brakepointPct - telemetry.pos;
            }
            else
            {
                brakepointDistancePct =
                    (1.0 - telemetry.pos) +
                    brakepointPct;
            }

            var brakepointDistanceFeet =
                brakepointDistancePct * trackFeet;


            // ------------------------------------------------
            // BRAKEPOINT COLOR BANDS
            // ------------------------------------------------

            if (brakepointDistanceFeet <= 100)
                return "Firebrick";

            if (brakepointDistanceFeet <= 200)
                return "SteelBlue";

            if (brakepointDistanceFeet <= 300)
                return "Orange";

            if (brakepointDistanceFeet <= 400)
                return "Gainsboro";

            return "Transparent";
        }
    }


    // ========================================================
    // --------------------------------------------------------
    // PHASE 2: THROTTLE PICKUP TARGET
    // --------------------------------------------------------
    // ========================================================

    // We only get here after the brakepoint target
    // has been reached.

    if (!root[throttleReachedKey])
    {
        var throttleTargetFeet =
            Number(GetThrottlePickupTarget(areaNumber));

        if (isNaN(throttleTargetFeet) ||
            throttleTargetFeet <= 0)
        {
            return "Transparent";
        }

        var throttleTargetPct =
            throttleTargetFeet / trackFeet;


        // ----------------------------------------------------
        // Detect throttle pickup target crossing
        // ----------------------------------------------------

        var throttleCrossed =
            false;


        // Normal forward crossing
        if (lapState.previousPos <= throttleTargetPct &&
            lapState.currentPos >= throttleTargetPct)
        {
            throttleCrossed =
                true;
        }

        // Start/finish wrap crossing
        else if (
            lapState.previousPos > 0.90 &&
            lapState.currentPos < 0.10 &&
            (
                throttleTargetPct >= lapState.previousPos ||
                throttleTargetPct <= lapState.currentPos
            )
        )
        {
            throttleCrossed =
                true;
        }


        // ----------------------------------------------------
        // Throttle target reached
        // ----------------------------------------------------

        if (throttleCrossed)
        {
            root[throttleReachedKey] =
                true;

            return "Transparent";
        }


        // ----------------------------------------------------
        // Calculate distance to throttle pickup
        // ----------------------------------------------------

        var throttleDistancePct;

        if (throttleTargetPct >= telemetry.pos)
        {
            throttleDistancePct =
                throttleTargetPct - telemetry.pos;
        }
        else
        {
            throttleDistancePct =
                (1.0 - telemetry.pos) +
                throttleTargetPct;
        }

        var throttleDistanceFeet =
            throttleDistancePct * trackFeet;


        // ----------------------------------------------------
        // THROTTLE PICKUP COLOR BANDS
        // ----------------------------------------------------

    //    if (throttleDistanceFeet <= 100)
    //        return "Green";

     //   if (throttleDistanceFeet <= 200)
    //        return "Gainsboro";

        return "Transparent";
    }


    // ========================================================
    // THROTTLE PICKUP ALREADY REACHED
    // ========================================================

    return "Transparent";
}

function GetBrakepointDiffFastest(areaNumber)
{
if (FastestAreaBrakePoint(areaNumber) == 0) return " ";

var diff = LapBrakePoint(areaNumber) - FastestAreaBrakePoint(areaNumber);
if(diff > 0)
{
return diff + " ft late";
}
else if (diff < 0)
{
return Math.abs(diff) + " ft early";
}
else
{
var deltaToTarget = LapBrakePoint(areaNumber) - GetBrakepointTarget(areaNumber);
if(deltaToTarget > 0)
{
return "* " + deltaToTarget + " > TGT";
}
else if (deltaToTarget < 0)
{
return "* " + Math.abs(deltaToTarget) + " < TGT";
}
else
{
return "SAME";
}
}

}


function GetBrakepointDiffTarget(areaNumber)
{
if(GetBrakepointTarget(areaNumber) == 0) return " ";
if(LapBrakePoint(areaNumber) == 0) return " ";

var diff = LapBrakePoint(areaNumber) - GetBrakepointTarget(areaNumber);
if(diff > 0)
{
return diff + " ft late";
}
else if (diff < 0)
{
return Math.abs(diff) + " ft early";
}
else
{
return "NAILED";
}
}


function GetBrakePressureDiffTarget(areaNumber)
{
if(GetBrakePressureTarget(areaNumber) == 0) return " ";
if(GetAreaMaxBrake(areaNumber) == 0) return " ";

var diff = GetAreaMaxBrake(areaNumber) - GetBrakePressureTarget(areaNumber);
if(diff > 0)
{
return diff + " HEAVY";
}
else if (diff < 0)
{
return Math.abs(diff) + " light";
}
else
{
return "SAME";
}
}


function GetBrakePressureDiffTargetColor(areaNumber)
{
var diff = GetAreaMaxBrake(areaNumber) - GetBrakePressureTarget(areaNumber);

if(diff < -3)
{
return "SteelBlue";
}
else if (diff > 3)
{
return "Firebrick";
}
else
{
return "ForestGreen";
}
}


function GetThrottlePickupDiffTarget(areaNumber)
{
if(GetThrottlePickupTarget(areaNumber) == 0) return " ";
if(GetThrottlePickupPoint(areaNumber) == 0) return " ";

var diff = GetThrottlePickupPoint(areaNumber) - GetThrottlePickupTarget(areaNumber);
if(diff >= 0)
{
return diff + " ft late";
}
else if (diff < 0)
{
return Math.abs(diff) + " ft early";
}

}


function GetThrottlePickupColorTarget(areaNumber)
{
var diff = GetThrottlePickupPoint(areaNumber) - GetThrottlePickupTarget(areaNumber);
if (diff > 10)
{
return "Firebrick";
}
else
{
return "ForestGreen";
}
}



function GetBrakepointColor(areaNumber)
{
var diff = LapBrakePoint(areaNumber) - FastestAreaBrakePoint(areaNumber);

if(diff < -10)
{
return "SteelBlue";
}
else if (diff > 10)
{
return "Firebrick";
}
else
{
return "ForestGreen";
}

}

function GetBrakepointColorTarget(areaNumber)
{
var diff = LapBrakePoint(areaNumber) - GetBrakepointTarget(areaNumber);

if(diff < -10)
{
return "SteelBlue";
}
else if (diff > 10)
{
return "Firebrick";
}
else
{
return "ForestGreen";
}

}


// ============================================================
// AREA MAXIMUM BRAKE PRESSURE
// ============================================================
//
// Tracks the maximum brake pressure reached while the car is
// inside the specified area. The value is displayed as a whole
// percentage (0-100).
//
// The measurement resets when a new session starts and a new
// measurement begins each time the area start is crossed.
// ============================================================

function GetAreaMaxBrake(areaNumber)
{
    var telemetry = GetTelemetry();

    var pos = Number(telemetry.pos);
    var brake = Number(telemetry.brake);
    var trackName = telemetry.trackName;
    var sessionID = telemetry.sessionID;

    if (isNaN(pos) || isNaN(brake) ||
        trackName == null || sessionID == null)
    {
        return 0;
    }

    var area = GetArea(trackName, areaNumber);

    if (area == null)
        return 0;

    var start = Number(area.start);
    var end = Number(area.end);

    if (isNaN(start) || isNaN(end))
        return 0;

    var prefix = GetStatePrefix(
        "AreaMaxBrake",
        trackName,
        start,
        end
    );

    var sessionKey = prefix + "_Session";
    var lapKey = prefix + "_Lap";
    var maxKey = prefix + "_Max";
    var previousPosKey = prefix + "_PreviousPos";

    var lapState = GetLapState();

    // Initialize state.
    InitializeState(sessionKey, sessionID);
    InitializeState(lapKey, lapState.lap);
    InitializeState(maxKey, 0);
    InitializeState(previousPosKey, pos);

    // Reset when the iRacing session changes.
    if (IsNewSession(sessionKey, sessionID))
    {
        ResetState(lapKey, lapState.lap);
        ResetState(maxKey, 0);
        ResetState(previousPosKey, pos);
        return 0;
    }

    // Start a completely new measurement on each lap.
    if (root[lapKey] != lapState.lap)
    {
        ResetState(lapKey, lapState.lap);
        ResetState(maxKey, 0);
        ResetState(previousPosKey, pos);
    }

    // Determine whether the car is currently inside the configured area.
    // This intentionally uses the CURRENT position rather than waiting
    // for an area-start crossing event. That makes the maximum brake value
    // update immediately while the car is in the area.
    var insideArea;

    if (start <= end)
    {
        insideArea =
            pos >= start &&
            pos <= end;
    }
    else
    {
        // Area crosses the start/finish line.
        insideArea =
            pos >= start ||
            pos <= end;
    }

    // Continuously update the maximum while the car is in the area.
    // Brake is stored by iRacing as 0.0 - 1.0, so return it as 0 - 100.
    if (insideArea && brake > Number(root[maxKey]))
    {
        root[maxKey] = brake;
    }

    root[previousPosKey] = pos;

    // IMPORTANT:
    // Return the LIVE maximum while inside the area. Do not wait until
    // the area has been exited to calculate or display the value.
    return Math.round(Number(root[maxKey]) * 100);
}

function GetThrottlePickupPoint(areaNumber)
{
    var telemetry = GetTelemetry();

    var pos = telemetry.pos;
    var throttle = Number($prop('GameRawData.Telemetry.Throttle'));
    var trackName = telemetry.trackName;
    var trackLength = telemetry.trackLength;
    var sessionID = telemetry.sessionID;

    if (pos == null ||
        throttle == null ||
        trackName == null ||
        trackLength == null ||
        sessionID == null)
    {
        return 0;
    }

    var area = GetArea(trackName, areaNumber);

    if (area == null)
        return 0;

    var start = Number(area.start);
    var end = Number(area.end);

    if (isNaN(start) || isNaN(end))
        return 0;

    var prefix = GetStatePrefix(
        "ThrottlePickup",
        trackName,
        start,
        end
    );

    var sessionKey    = prefix + "_Session";
    var previousPosKey = prefix + "_PreviousPos";
    var timingKey     = prefix + "_Timing";
    var recordingKey  = prefix + "_Recording";
    var pickupPointKey = prefix + "_PickupPoint";

    // ------------------------------------------------------------
    // INITIALIZE STATE
    // ------------------------------------------------------------

    InitializeState(sessionKey, sessionID);
    InitializeState(previousPosKey, Number(pos));
    InitializeState(timingKey, false);
    InitializeState(recordingKey, false);
    InitializeState(pickupPointKey, 0);

    // ------------------------------------------------------------
    // NEW SESSION
    // ------------------------------------------------------------

    if (IsNewSession(sessionKey, sessionID))
    {
        ResetState(previousPosKey, Number(pos));
        ResetState(timingKey, false);
        ResetState(recordingKey, false);
        ResetState(pickupPointKey, 0);

        return 0;
    }

    var previousPos = Number(root[previousPosKey]);

    // ------------------------------------------------------------
    // AREA START CROSSING
    //
    // A new area entry starts a new measurement.
    // ------------------------------------------------------------

    var crossedStart = GetCrossingTime(
        previousPos,
        Number(pos),
        0,
        0,
        start
    );

    if (crossedStart != null)
    {
        ResetState(timingKey, true);
        ResetState(recordingKey, false);
        ResetState(pickupPointKey, 0);
    }

    // ------------------------------------------------------------
    // AREA END CROSSING
    //
    // Stop tracking once we leave the area.
    // ------------------------------------------------------------

    var crossedEnd = GetCrossingTime(
        previousPos,
        Number(pos),
        0,
        0,
        end
    );

    if (crossedEnd != null && root[timingKey] === true)
    {
        ResetState(timingKey, false);
    }

    // ------------------------------------------------------------
    // THROTTLE PICKUP DETECTION
    //
    // First throttle must fall to 1% or below.
    // After that, the first throttle value ABOVE 98% is
    // the throttle pickup point.
    // ------------------------------------------------------------

    if (root[timingKey] === true &&
        Number(root[pickupPointKey]) === 0)
    {
        // Throttle has reached 1% or below.
        if (throttle <= 0.01)
        {
            ResetState(recordingKey, true);
        }

        // Throttle has subsequently risen above 2%.
        if (root[recordingKey] === true &&
            throttle > 0.75)
        {
            ResetState(
                pickupPointKey,
                Number(pos)
            );

            ResetState(recordingKey, false);
        }
    }

    // ------------------------------------------------------------
    // SAVE CURRENT POSITION
    // ------------------------------------------------------------

    ResetState(previousPosKey, Number(pos));

    // ------------------------------------------------------------
    // RETURN PICKUP POINT IN FEET
    // ------------------------------------------------------------

    var pickupPoint = Number(root[pickupPointKey]);

    if (pickupPoint <= 0)
        return 0;

    var feet =
        pickupPoint *
        Number(trackLength) *
        3.280839895;

    return Math.round(feet);
}


function GetControlOverlapDistance(areaNumber)
{
    var telemetry =
        GetTelemetry();

    var throttle =
        $prop('GameRawData.Telemetry.Throttle');


    if (telemetry.pos == null ||
        telemetry.brake == null ||
        throttle == null ||
        telemetry.trackLength == null)
    {
        return 0;
    }


    var trackName =
        telemetry.trackName;


    if (trackName == null ||
        trackName == "")
    {
        return 0;
    }


    var area =
        GetArea(
            trackName,
            areaNumber
        );


    // Return a blank value when this focus area is not configured.
    if (area == null)
        return "";


    // ========================================================
    // STATE KEYS
    // ========================================================

    var prefix =
        GetStatePrefix(
            "CONTROL_OVERLAP_" +
            String(trackName).toLowerCase() +
            "_A" +
            areaNumber,
            area.name,
            area.start,
            area.end
        );


    var prevPosKey =
        prefix + "_PrevPos";

    var timingKey =
        prefix + "_Timing";

    var overlapDistanceKey =
        prefix + "_OverlapDistance";

    var sessionKey =
        prefix + "_Session";


    // ========================================================
    // INITIALIZE
    // ========================================================

    InitializeState(
        prevPosKey,
        telemetry.pos
    );

    InitializeState(
        timingKey,
        false
    );

    InitializeState(
        overlapDistanceKey,
        0
    );

    InitializeState(
        sessionKey,
        telemetry.sessionID
    );


    // ========================================================
    // NEW SESSION
    // ========================================================

    if (IsNewSession(
            sessionKey,
            telemetry.sessionID))
    {
        ResetState(
            timingKey,
            false
        );

        ResetState(
            overlapDistanceKey,
            0
        );

        ResetState(
            prevPosKey,
            telemetry.pos
        );
    }


    var previousPos =
        root[prevPosKey];


    // ========================================================
    // START OF AREA
    // ========================================================

    if (!root[timingKey])
    {
        var startCrossing =
            GetCrossingTime(
                previousPos,
                telemetry.pos,
                0,
                0,
                area.start
            );


        if (startCrossing != null)
        {
            ResetState(
                overlapDistanceKey,
                0
            );

            root[timingKey] =
                true;
        }
    }


    // ========================================================
    // INSIDE AREA
    // ========================================================

    if (root[timingKey])
    {
        var deltaPct =
            telemetry.pos -
            previousPos;


        // Handle lap wrap
        if (deltaPct < -0.5)
            deltaPct += 1.0;


        // Ignore invalid telemetry jumps
        if (deltaPct >= 0 &&
            deltaPct < 0.1)
        {
            // =================================================
            // BOTH BRAKE AND THROTTLE:
            // BETWEEN 0 and 20 %
            // =================================================

            var brakeInControlRange =
                Number(telemetry.brake) > 0.005 &&
                Number(telemetry.brake) < 0.20;

            var throttleInControlRange =
                Number(throttle) > 0.005 &&
                Number(throttle) < 0.20;


            if (brakeInControlRange &&
                throttleInControlRange)
            {
                var distanceFeet =
                    deltaPct *
                    Number(telemetry.trackLength) *
                    3.280839895;


                root[overlapDistanceKey] +=
                    distanceFeet;
            }
        }


        // ====================================================
        // END OF AREA
        // ====================================================

        var endCrossing =
            GetCrossingTime(
                previousPos,
                telemetry.pos,
                0,
                0,
                area.end
            );


        if (endCrossing != null)
        {
            root[timingKey] =
                false;
        }
    }


    // ========================================================
    // SAVE TELEMETRY
    // ========================================================

    root[prevPosKey] =
        telemetry.pos;


    // ========================================================
    // RETURN DISTANCE IN FEET
    // ========================================================

    return Math.round(
        root[overlapDistanceKey]
    ) + " ft";
}


    // ========================================================
    // PEAK BRAKE PRESSURE
    // ========================================================
function GetMaximumBrakePressure()
{
    var brake = Math.round($prop('Brake'));
    var now = Date.now();

    if (root["PeakBrake"] == null) {
    root["PeakBrake"] = 0;
    root["PeakBrakeTime"] = 0;
    }

    if (brake > root["PeakBrake"]) {
    root["PeakBrake"] = brake;
    root["PeakBrakeTime"] = now;
    }

    if (root["PeakBrake"] > 0 && (now - root["PeakBrakeTime"]) >= 4000) {
    root["PeakBrake"] = 0;
    root["PeakBrakeTime"] = 0;
    }

    return root["PeakBrake"];
}


    // ========================================================
    // MINIMUM SPEED
    // ========================================================
function GetMinimumSpeed()
{
var speed = $prop('SpeedLocal');
 var now = Date.now();
 
 if (root["MinSpeed"] == null) {
 root["MinSpeed"] = speed;
 root["MinSpeedTime"] = now;
 }
 
 if (speed < root["MinSpeed"]) {
 root["MinSpeed"] = speed;
 root["MinSpeedTime"] = now;
 }
 
 if (now - root["MinSpeedTime"] >= 5000) {
 root["MinSpeed"] = speed;
 root["MinSpeedTime"] = now;
 }
 
 return format(root["MinSpeed"], "0.0");
}

