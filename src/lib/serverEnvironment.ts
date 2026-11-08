// Which server this is (docs/development-database.md). No imports, so the database guard and the tests can use it.
//
// The live server is the production build running on Render: NODE_ENV=production and Render's own RENDER=true, which
// Render sets on every service it runs and nothing sets on a Mac. `npm run build && npm start` on a Mac is
// NODE_ENV=production too, so NODE_ENV alone can't tell them apart. LIVE_SERVER=on or off overrides it either way.

type Env = Record<string, string | undefined>;

export function isLiveServer(env: Env = process.env): boolean {
  if (env.LIVE_SERVER === 'on') return true;
  if (env.LIVE_SERVER === 'off') return false;
  return env.NODE_ENV === 'production' && env.RENDER === 'true';
}

// The hourly and minutely jobs (lap retention, consent purge, the video worker, privacy jobs, telemetry storage jobs)
// write to and delete from the database, and some call paid services, so they run on the live server only, unless
// BACKGROUND_JOBS=on (the browser tests turn them on against their own database) or off.
export function backgroundJobsEnabled(env: Env = process.env): boolean {
  if (env.BACKGROUND_JOBS === 'on') return true;
  if (env.BACKGROUND_JOBS === 'off') return false;
  return isLiveServer(env);
}

// Error and spend monitoring email the owner and can switch the live site's paid services off: live server only,
// unless MONITORS=on
export function monitorsEnabled(env: Env = process.env): boolean {
  return env.MONITORS === 'on' || isLiveServer(env);
}

// What a server may do with a database, given how the database is marked (racingcoach."DatabaseEnvironment"; null
// when it isn't). The live server marks its database 'production' the first time it connects; any other server
// (npm run dev, a local npm start, the tests) refuses a database marked 'production', unless
// ALLOW_PRODUCTION_DATABASE=yes says that's meant.
export type DatabaseVerdict =
  | { allowed: true; mark: boolean; warning?: string }
  | { allowed: false; reason: string };

export function databaseVerdict(databaseEnvironment: string | null, env: Env = process.env): DatabaseVerdict {
  const live = isLiveServer(env);
  if (live) return { allowed: true, mark: databaseEnvironment !== 'production' };
  if (databaseEnvironment !== 'production') return { allowed: true, mark: false };
  if (env.ALLOW_PRODUCTION_DATABASE === 'yes') {
    return {
      allowed: true,
      mark: false,
      warning: 'ALLOW_PRODUCTION_DATABASE=yes: this non-production server is using the PRODUCTION database',
    };
  }
  return {
    allowed: false,
    reason:
      'Refusing to use the PRODUCTION database from a non-production server. DATABASE_URL points at the database ' +
      'the live site marked as production. Point it at your development database (docs/development-database.md), ' +
      'or set ALLOW_PRODUCTION_DATABASE=yes for this run if you really mean to.',
  };
}
