// Values of racingcoach."Users".role. Dependency-free so client components can use it.
// Subscriptions are tracked by account_status, not by role.
export const ROLES = {
  admin: 'Admin',
  user: 'User',
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export const isAdmin = (role: string | null | undefined) => role === ROLES.admin;
