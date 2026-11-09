import { redirect } from 'next/navigation';
import CoachingAnalysis from '@/components/CoachingAnalysis';
import { withReturnTo } from '@/lib/returnTo';
import { canUseLapSummary } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';

// The My Sessions page, for signed-in users only; anyone else logs in first and comes back here
export default async function RacingPage() {
  const user = await getCurrentUser();
  if (!user) redirect(withReturnTo('/login', '/racing'));
  return <CoachingAnalysis lapSummary={canUseLapSummary(user)} />;
}
