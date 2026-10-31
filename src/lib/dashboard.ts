import { query } from './db';
import { subscriptionView, trackMapPath, splitTrackName, type SubscriptionFacts, type SubscriptionView } from './dashboardRules';
import { ensureUserSchema, type User } from './users';
import type { TrackOutline } from './trackOutlines';

// The My Dashboard page's data, always for the signed-in user the page passes in. Everything comes from racingcoach."CollectorLaps",
// the only record of individual laps. "RaceResults" isn't counted: it holds one row per race, for Race Trends, and
// those races' laps are in "CollectorLaps" too when the collector was running. Like every read of those laps,
// expired ones are left out (lapRetentionDb.ts), so these are the driver's lap history, not a lifetime's. Only narrow
// columns are read: csv_gzip stays untouched, so these stay fast however large the CSVs are.

export type CareerStats = {
  laps: number;
  sessions: number;
  lapsThisWeek: number;
  // null when no lap has a known track length
  distanceFeet: number | null;
  // Laps left out of distanceFeet: without a track key (collectors before 1.29.0), or on a layout with no length yet
  lapsWithoutLength: number;
  cars: number;
  tracks: number;
  lastActive: string | null;
};

export type RecentSession = {
  car: string;
  track: string;
  config: string | null;
  sessionType: string;
  // When the session's latest lap was driven, not when it was uploaded
  at: string;
  mapPath: string | null;
};

export type DashboardData = {
  recentSession: RecentSession | null;
  careerStatistics: CareerStats | null;
  subscription: SubscriptionView;
};

// What makes two rows the same lap, as a played-back .ibt uploaded with --upload is the same driving under new
// clientLapIds: online, iRacing's subsession, session and lap number. Offline sessions have no iRacing IDs, so their
// lap number and exact lap time on that track and car stand in.
const LAP_KEY_SQL = `CASE WHEN l.iracing_subsession_id > 0
    THEN concat_ws('|', l.iracing_subsession_id, l.session_num, l.lap_number)
    ELSE concat_ws('|', 'offline', lower(l.track), lower(l.car), l.session_num, l.lap_number, l.lap_time_seconds) END`;

// As on the My Sessions page (RecordedLaps.tsx), laps in one offline session this far apart are separate sessions
const OFFLINE_SESSION_GAP = `interval '30 minutes'`;

// The track without its layout: the same rule as splitTrackName in dashboardRules.ts
const PHYSICAL_TRACK_SQL = `lower(regexp_replace(track_name, '\\s*\\([^()]*\\)\\s*$', ''))`;

// Laps the recorder threw away (interrupted, or left before the line) were never uploaded, so every row is a complete
// lap. Out and in laps count: they were driven.
export async function readCareerStats(userId: number): Promise<CareerStats> {
  await ensureUserSchema();
  const [row] = await query<{
    laps: number;
    sessions: number;
    laps_this_week: number;
    distance_feet: number | null;
    laps_without_length: number;
    cars: number;
    tracks: number;
    last_active: Date | null;
  }>(
    `WITH laps AS (
       SELECT DISTINCT ON (lap_key) lap_key, track, track_key, car, subsession_id, session_num, completed_at
       FROM (
         SELECT ${LAP_KEY_SQL} AS lap_key, l.track, l.track_key, l.car, l.iracing_subsession_id AS subsession_id, l.session_num, l.completed_at, l.id
         FROM racingcoach."CollectorLaps" l
         WHERE l.user_id = $1 AND l.expires_at > now()
       ) keyed
       ORDER BY lap_key, completed_at, id
     ), detailed AS (
       SELECT l.car, l.subsession_id, l.session_num, l.completed_at, t.track_length_feet,
              COALESCE(t.track_name, l.track) AS track_name,
              l.completed_at - lag(l.completed_at) OVER (
                PARTITION BY lower(l.track), lower(l.car), l.subsession_id, l.session_num ORDER BY l.completed_at
              ) AS since_previous
       FROM laps l LEFT JOIN racingcoach."Tracks" t ON lower(t.track_key) = lower(l.track_key)
     )
     SELECT count(*)::int AS laps,
            (count(DISTINCT subsession_id::text || '|' || session_num::text) FILTER (WHERE subsession_id > 0)
             + count(*) FILTER (WHERE subsession_id = 0 AND (since_previous IS NULL OR since_previous >= ${OFFLINE_SESSION_GAP})))::int AS sessions,
            (count(*) FILTER (WHERE completed_at > now() - interval '7 days'))::int AS laps_this_week,
            sum(track_length_feet)::float8 AS distance_feet,
            (count(*) FILTER (WHERE track_length_feet IS NULL))::int AS laps_without_length,
            count(DISTINCT lower(car))::int AS cars,
            count(DISTINCT ${PHYSICAL_TRACK_SQL})::int AS tracks,
            max(completed_at) AS last_active
     FROM detailed`,
    [userId]
  );
  return {
    laps: row.laps,
    sessions: row.sessions,
    lapsThisWeek: row.laps_this_week,
    distanceFeet: row.distance_feet,
    lapsWithoutLength: row.laps_without_length,
    cars: row.cars,
    tracks: row.tracks,
    lastActive: row.last_active?.toISOString() ?? null,
  };
}

// The latest driving by when it was driven (completed_at), of any session type: a late upload of an old session doesn't
// count as recent. Track Data's name is used when the lap's key finds it, as iRacing can name a layout differently.
export async function readRecentSession(userId: number): Promise<RecentSession | null> {
  await ensureUserSchema();
  const [row] = await query<{
    track: string;
    car: string;
    session_type: string;
    completed_at: Date;
    track_name: string | null;
    config_name: string | null;
    track_outline: TrackOutline | null;
  }>(
    `SELECT l.track, l.car, l.session_type, l.completed_at, t.track_name, t.config_name, t.track_outline
     FROM racingcoach."CollectorLaps" l LEFT JOIN racingcoach."Tracks" t ON lower(t.track_key) = lower(l.track_key)
     WHERE l.user_id = $1 AND l.expires_at > now()
     ORDER BY l.completed_at DESC, l.id DESC LIMIT 1`,
    [userId]
  );
  if (!row) return null;
  const { track, config } = splitTrackName(row.track_name ?? row.track);
  const layout = row.config_name ?? config;
  return {
    car: row.car,
    track,
    // iRacing's name for a track with one layout
    config: layout && layout.toLowerCase() !== 'default' ? layout : null,
    sessionType: row.session_type,
    at: row.completed_at.toISOString(),
    mapPath: trackMapPath(row.track_outline),
  };
}

// The account's subscription, read at each visit from what the Stripe webhook saved: the one the account points at
// (so a Silver subscription waiting to be canceled after buying Gold isn't shown), else the latest
async function readStripeSubscription(user: User): Promise<SubscriptionFacts['stripe']> {
  await ensureUserSchema();
  const [row] = await query<{
    stripe_subscription_id: string;
    status: string;
    cancel_at_period_end: boolean;
    cancel_at: Date | null;
    current_period_end: Date | null;
    next_invoice_at: Date | null;
  }>(
    `SELECT stripe_subscription_id, status, cancel_at_period_end, cancel_at, current_period_end, next_invoice_at
     FROM racingcoach."StripeSubscriptions" WHERE user_id = $1
     ORDER BY stripe_subscription_id IS NOT DISTINCT FROM $2::text DESC, start_date DESC LIMIT 1`,
    [user.id, user.stripeSubscriptionId]
  );
  if (!row) return null;
  return {
    id: row.stripe_subscription_id,
    status: row.status,
    cancelAtPeriodEnd: row.cancel_at_period_end,
    cancelAt: row.cancel_at?.toISOString() ?? null,
    currentPeriodEnd: row.current_period_end?.toISOString() ?? null,
    nextInvoiceAt: row.next_invoice_at?.toISOString() ?? null,
  };
}

// A section that can't load shows as unavailable rather than taking the page down or showing wrong numbers. The
// subscription falls back on the account's own columns (getUserById keeps them current).
const orNull = <T,>(section: string, read: Promise<T>): Promise<T | null> =>
  read.catch((error) => {
    console.error(`My Dashboard: ${section} failed:`, error);
    return null;
  });

export async function readDashboard(user: User): Promise<DashboardData> {
  const [careerStatistics, recentSession, stripe] = await Promise.all([
    orNull('career statistics', readCareerStats(user.id)),
    orNull('recent session', readRecentSession(user.id)),
    orNull('subscription', readStripeSubscription(user)),
  ]);
  return {
    careerStatistics,
    recentSession,
    subscription: subscriptionView({
      membershipLevel: user.membershipLevel,
      accountStatus: user.accountStatus,
      subscriptionEndDate: user.subscriptionEndDate,
      stripeSubscriptionId: user.stripeSubscriptionId,
      stripe,
    }),
  };
}
