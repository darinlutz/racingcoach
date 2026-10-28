// Runs once when a Next.js server instance starts (Next.js's instrumentation hook). Starts the hourly lap retention
// cleanup (src/lib/lapRetention.ts) in the Node.js server only.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startLapRetentionSchedule } = await import('./lib/lapRetention');
    startLapRetentionSchedule();
  }
}
