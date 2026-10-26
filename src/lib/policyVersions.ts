// The current version of each legal document (src/lib/legal.ts), its effective date. Change a version together
// with the document's effectiveDate whenever its wording changes. Signing up records the versions the signup
// form showed, with when, in racingcoach."PolicyAcceptances" (createUser in src/lib/users.ts).
// Kept apart from legal.ts so the signup form can import it without the documents' text.
export const POLICY_VERSIONS = {
  terms: '2026-10-26',
  privacy: '2026-10-26',
} as const;

export type Policy = keyof typeof POLICY_VERSIONS;

export type PolicyVersions = Record<Policy, string>;

// Whether a signup request accepted exactly the current versions (a page loaded before a policy changed hasn't)
export function isCurrentPolicyVersions(value: unknown): value is PolicyVersions {
  if (!value || typeof value !== 'object') return false;
  const versions = value as Record<string, unknown>;
  return (Object.keys(POLICY_VERSIONS) as Policy[]).every((policy) => versions[policy] === POLICY_VERSIONS[policy]);
}
