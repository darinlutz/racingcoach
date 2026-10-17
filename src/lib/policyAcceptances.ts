import { query } from './db';
import { POLICY_VERSIONS, type Policy, type PolicyVersions } from './policyVersions';
import { ensureUserSchema } from './users';

// Which versions of the Terms of Service and Privacy Policy (src/lib/policyVersions.ts) each user accepted, and how
// (racingcoach."PolicyAcceptances".source): 'signup' (creating the account, createUser in src/lib/users.ts),
// 'website' (the notice the root layout shows a signed-in user who hasn't accepted the current versions,
// src/components/PolicyUpdateNotice.tsx) or 'collector-installer' (the collector's installer, reported by the
// collector with its upload key once it's signed in, src/app/api/collector/policy-acceptance). accepted_at is when
// the row was recorded; for the installer, the time it was accepted is in the PC's registry
// (HKLM\Software\RacingCoach.app\Collector\LegalAcceptance), and isn't proof of who clicked.

export type PolicyAcceptanceSource = 'signup' | 'website' | 'collector-installer';

// Whether the user has accepted the current version of every policy (accounts from before the policies, or from
// before a policy changed, haven't)
export async function hasAcceptedCurrentPolicies(userId: number): Promise<boolean> {
  await ensureUserSchema();
  const rows = await query<{ policy: string; version: string }>(
    'SELECT policy, version FROM racingcoach."PolicyAcceptances" WHERE user_id = $1',
    [userId]
  );
  return (Object.keys(POLICY_VERSIONS) as Policy[]).every((p) =>
    rows.some((r) => r.policy === p && r.version === POLICY_VERSIONS[p])
  );
}

// Records the user's acceptance of these versions; accepting a version again keeps the first record
export async function recordPolicyAcceptance(userId: number, versions: PolicyVersions, source: PolicyAcceptanceSource): Promise<void> {
  await ensureUserSchema();
  for (const [policy, version] of Object.entries(versions)) {
    await query(
      `INSERT INTO racingcoach."PolicyAcceptances" (user_id, policy, version, source) VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, policy, version) DO NOTHING`,
      [userId, policy, version, source]
    );
  }
}
