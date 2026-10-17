import { NextResponse } from 'next/server';
import { apiText } from '@/lib/i18n/server';
import { recordPolicyAcceptance } from '@/lib/policyAcceptances';
import { isCurrentPolicyVersions } from '@/lib/policyVersions';
import { getCurrentUser } from '@/lib/session';

// The signed-in user accepts the current Terms of Service and Privacy Policy, from the notice the root layout shows
// when they haven't (src/components/PolicyUpdateNotice.tsx). Body: { acceptedPolicies: { terms, privacy } }, the
// versions the notice showed, like signing up; a page loaded before a policy changed gets 409 and must be reloaded.
export async function POST(request: Request) {
  const user = await getCurrentUser();
  const t = await apiText(user);
  try {
    if (!user) {
      return NextResponse.json({ error: t.logInPolicies }, { status: 401 });
    }
    const body = await request.json().catch(() => ({}));
    if (!isCurrentPolicyVersions(body.acceptedPolicies)) {
      return NextResponse.json({ error: t.policiesChanged }, { status: 409 });
    }
    await recordPolicyAcceptance(user.id, body.acceptedPolicies, 'website');
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Policy acceptance error:', error);
    return NextResponse.json({ error: t.failedSavePolicies }, { status: 500 });
  }
}
