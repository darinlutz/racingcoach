// Values of racingcoach."Users".role. Only imports accountStatus.ts (also dependency-free) so client components can
// use it. Subscriptions are tracked by account_status, not by role. Admins set roles on the Admin page.
import { MEMBERSHIP_LEVEL } from './accountStatus';

export const ROLES = {
  admin: 'Admin',
  coach: 'Coach',
  user: 'User',
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

// In the order the Admin page's role box lists them
export const ROLE_VALUES: readonly Role[] = [ROLES.admin, ROLES.coach, ROLES.user];

export const isRole = (value: unknown): value is Role => ROLE_VALUES.includes(value as Role);

export const isAdmin = (role: string | null | undefined) => role === ROLES.admin;

// Coaches and Admins can open every driver's recorded laps; Users only their own and Coaches' (LapViewer in
// collectorLaps.ts)
export const canSeeAllLaps = (role: string | null | undefined) => role === ROLES.admin || role === ROLES.coach;

// Coaches and Admins see the Coach page and write the AI Coach Instructions
export const canCoach = (role: string | null | undefined) => role === ROLES.admin || role === ROLES.coach;

// Coaches and Admins see the Subscribers page (src/app/admin/subscribers/), linked from the Admin and Coach pages
export const canSeeSubscribers = canCoach;

// The In-Car AI Coach is for Gold members (and Admins): the collector's /api/collector/in-car-coach and the Account
// page's In-Car AI Coach Instructions
export const canUseInCarCoach = (user: { membershipLevel: string; role: string }) =>
  user.role === ROLES.admin || user.membershipLevel === MEMBERSHIP_LEVEL.gold;

// How many of the newest stints (sessions) Debrief Coach's recorded laps list shows: 8 for Bronze, 20 for Silver,
// 50 for Gold members, Coaches and Admins (the most anyone sees)
export const STINT_LIMITS = { bronze: 8, silver: 20, max: 50 } as const;

export const recordedStintLimit = (user: { membershipLevel: string; role: string }): number =>
  user.role === ROLES.admin || user.role === ROLES.coach || user.membershipLevel === MEMBERSHIP_LEVEL.gold
    ? STINT_LIMITS.max
    : user.membershipLevel === MEMBERSHIP_LEVEL.silver
      ? STINT_LIMITS.silver
      : STINT_LIMITS.bronze;
