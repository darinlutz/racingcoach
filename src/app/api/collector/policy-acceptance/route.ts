import { NextResponse } from 'next/server';
import { authenticateCollector } from '@/lib/collectorKeys';
import { recordPolicyAcceptance } from '@/lib/policyAcceptances';
import { POLICY_VERSIONS } from '@/lib/policyVersions';

// The collector reports the Terms of Service and Privacy Policy versions its installer's legal page accepted
// (HKLM\Software\RacingCoach.app\Collector\LegalAcceptance, collector/installer/RacingCoach.Collector.iss), so the
// account that uses it has them on record (racingcoach."PolicyAcceptances", source 'collector-installer'). Sent once
// per start and upload key; recording a version again changes nothing. Body: { termsVersion, privacyVersion,
// acceptedAtUtc, installerVersion } (LegalAcceptance.cs; the last two aren't stored). Only the current versions are recorded: an older one doesn't count as accepting the
// current ones, which the website then asks for. Answers { recorded }. Authenticated with the upload key.
export async function POST(request: Request) {
  try {
    const userId = await authenticateCollector(request);
    if (userId === null) {
      return NextResponse.json({ error: 'Missing or unknown upload key' }, { status: 401 });
    }
    const body = await request.json().catch(() => ({}));
    if (body.termsVersion !== POLICY_VERSIONS.terms || body.privacyVersion !== POLICY_VERSIONS.privacy) {
      return NextResponse.json({ recorded: false });
    }
    await recordPolicyAcceptance(userId, { terms: body.termsVersion, privacy: body.privacyVersion }, 'collector-installer');
    return NextResponse.json({ recorded: true });
  } catch (error) {
    console.error('Collector policy acceptance error:', error);
    return NextResponse.json({ error: 'Failed to record the acceptance' }, { status: 500 });
  }
}
