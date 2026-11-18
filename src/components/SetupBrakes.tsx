'use client';

import BrakeEngineeringView from '@/components/BrakeEngineeringView';
import { useLanguage } from '@/components/LanguageProvider';
import SetupFocusComparison from '@/components/SetupFocusComparison';
import { compareBrakes } from '@/lib/brakesGeometry';

type Props = Omit<Parameters<typeof SetupFocusComparison>[0], 'focus' | 'question' | 'children'>;

// The Setups page's Brakes tab (docs/setups.md): the two revisions Compare has, drawn by BrakeEngineeringView
export default function SetupBrakes(props: Props) {
  const { t } = useLanguage();
  return (
    <SetupFocusComparison {...props} focus="brakes" question={t.setups.brakes.engineerQuestion}>
      {(rows, ask) => <BrakeEngineeringView comparison={compareBrakes(rows)} engineer={ask} />}
    </SetupFocusComparison>
  );
}
