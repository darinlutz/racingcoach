// Runs once when a Next.js server instance starts (Next.js's instrumentation hook). Starts the hourly lap retention
// cleanup (src/lib/lapRetention.ts), the daily purge of expired cookie consent records
// (src/lib/cookieConsentRecords.ts), the broadcast video worker (src/lib/videoProcessing.ts) and the privacy request
// worker (src/lib/privacyJobs.ts) in the Node.js server only.
//
// Only on the live server (src/lib/serverEnvironment.ts): they delete laps, purge records and call paid services, so a
// local `npm run dev` must never run them against any database, least of all production's. BACKGROUND_JOBS=on turns
// them on elsewhere (the browser tests do, against their own database).
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { backgroundJobsEnabled, monitorsEnabled } = await import('./lib/serverEnvironment');
  if (!backgroundJobsEnabled()) {
    console.log('Background jobs are off: not the live server (BACKGROUND_JOBS=on turns them on)');
  } else {
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
    // Deletes AI inference events older than 90 days (src/lib/localAi/store.ts)
    const { startLocalAiJobs } = await import('./lib/localAi/store');
    startLocalAiJobs();
  }
  // Error and spend monitoring (src/lib/errorMonitor.ts, src/lib/spendMonitor.ts): on the live site only, so a
  // local server never emails the owner about its own errors or switches the live site's paid services off
  if (monitorsEnabled()) {
    const { startErrorMonitor } = await import('./lib/errorMonitor');
    startErrorMonitor();
    const { startSpendMonitor } = await import('./lib/spendMonitor');
    startSpendMonitor();
  }
}

// Errors no route caught (a thrown handler, a failed server render): counted by the error monitor with the path,
// never the query string
export async function onRequestError(error: unknown, request: { path: string; method: string }) {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { recordError } = await import('./lib/errorMonitor');
  recordError(`${request.method} ${request.path.split('?')[0]}`, [error]);
}
