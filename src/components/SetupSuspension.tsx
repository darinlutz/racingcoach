'use client';

import { useLanguage } from '@/components/LanguageProvider';
import SetupFocusComparison from '@/components/SetupFocusComparison';
import SuspensionEngineeringView from '@/components/SuspensionEngineeringView';
import { compareSuspension } from '@/lib/suspensionGeometry';

type Props = Omit<Parameters<typeof SetupFocusComparison>[0], 'focus' | 'question' | 'children'>;

// The Setups page's Suspension tab (docs/setups.md): the two revisions Compare has, drawn by SuspensionEngineeringView
export default function SetupSuspension(props: Props) {
  const { t } = useLanguage();
  return (
    <SetupFocusComparison {...props} focus="suspension" question={t.setups.suspension.engineerQuestion}>
      {(rows, ask) => <SuspensionEngineeringView comparison={compareSuspension(rows)} engineer={ask} />}
    </SetupFocusComparison>
  );
}
