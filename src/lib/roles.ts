// Values of racingcoach."Users".role. Dependency-free so client components can use it.
// Subscriptions are tracked by account_status, not by role. Admins set roles on the Admin page.
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

// Coaches and Admins can open every driver's recorded laps; Users only their own
export const canSeeAllLaps = (role: string | null | undefined) => role === ROLES.admin || role === ROLES.coach;
