// Runs once when a Next.js server instance starts (Next.js's instrumentation hook). Starts the hourly lap retention
// cleanup (src/lib/lapRetention.ts), the daily purge of expired cookie consent records
// (src/lib/cookieConsentRecords.ts), the broadcast video worker (src/lib/videoProcessing.ts) and the privacy request
// worker (src/lib/privacyJobs.ts) in the Node.js server only.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startLapRetentionSchedule } = await import('./lib/lapRetention');
    startLapRetentionSchedule();
    const { startConsentRecordPurge } = await import('./lib/cookieConsentRecords');
    startConsentRecordPurge();
    const { startVideoProcessing } = await import('./lib/videoProcessing');
    startVideoProcessing();
    const { startPrivacyJobs } = await import('./lib/privacyJobs');
    startPrivacyJobs();
    // The lap telemetry store's cleanup queue, reconciliation and counters (src/lib/telemetryStorageJobs.ts)
    const { startTelemetryStorageJobs } = await import('./lib/telemetryStorageJobs');
    startTelemetryStorageJobs();
  }
}
