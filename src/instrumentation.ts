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
    // Error and spend monitoring (src/lib/errorMonitor.ts, src/lib/spendMonitor.ts): on the live site only, so a
    // local server never emails the owner about its own errors or switches the live site's paid services off
    if (process.env.NODE_ENV === 'production' || process.env.MONITORS === 'on') {
      const { startErrorMonitor } = await import('./lib/errorMonitor');
      startErrorMonitor();
      const { startSpendMonitor } = await import('./lib/spendMonitor');
      startSpendMonitor();
    }
  }
}

// Errors no route caught (a thrown handler, a failed server render): counted by the error monitor with the path,
// never the query string
export async function onRequestError(error: unknown, request: { path: string; method: string }) {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { recordError } = await import('./lib/errorMonitor');
  recordError(`${request.method} ${request.path.split('?')[0]}`, [error]);
}
