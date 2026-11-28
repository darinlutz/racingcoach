// How big one lap's CSV may be, shared by the browser (lapData.ts) and the server (collectorLaps.ts,
// telemetryStorage.ts, telemetryMigration.ts). A row is about 330-400 bytes at 60 Hz, so 64 MB is roughly 45 minutes of
// driving: the Nordschleife in a slow car, or a lap with a long pit stop, fits easily. The collector throws away a lap
// in which the car sat still for over 10 minutes (StandstillWatch.cs), so a lap left running for hours never gets here.
export const MAX_LAP_CSV_BYTES = 64 * 1024 * 1024;
// The same lap gzip-compressed, as the collector uploads it and the telemetry store keeps it; these CSVs compress to
// about a quarter, so this leaves room
export const MAX_LAP_GZIP_BYTES = 24 * 1024 * 1024;
