import { redirect } from 'next/navigation';
import CoachingAnalysis from '@/components/CoachingAnalysis';
import { withReturnTo } from '@/lib/returnTo';
import { getCurrentUser } from '@/lib/session';

// The Coaching & Analysis page, for signed-in users only; anyone else logs in first and comes back here
export default async function RacingPage() {
  if (!(await getCurrentUser())) redirect(withReturnTo('/login', '/racing'));
  return <CoachingAnalysis />;
}
