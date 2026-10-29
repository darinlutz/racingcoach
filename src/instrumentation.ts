// Runs once when a Next.js server instance starts (Next.js's instrumentation hook). Starts the hourly lap retention
// cleanup (src/lib/lapRetention.ts) and the daily purge of expired cookie consent records
// (src/lib/cookieConsentRecords.ts) in the Node.js server only.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startLapRetentionSchedule } = await import('./lib/lapRetention');
    startLapRetentionSchedule();
    const { startConsentRecordPurge } = await import('./lib/cookieConsentRecords');
    startConsentRecordPurge();
  }
}
