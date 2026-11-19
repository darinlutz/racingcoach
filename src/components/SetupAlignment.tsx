'use client';

import AlignmentEngineeringView from '@/components/AlignmentEngineeringView';
import { useLanguage } from '@/components/LanguageProvider';
import { Panel } from '@/components/SetupBadges';
import SetupFocusComparison from '@/components/SetupFocusComparison';
import { compareAlignment } from '@/lib/alignmentGeometry';

type Props = Omit<Parameters<typeof SetupFocusComparison>[0], 'focus' | 'question' | 'children'>;

// The Setups page's Alignment tab (docs/setups.md): the two revisions Compare has, drawn by AlignmentEngineeringView
export default function SetupAlignment(props: Props) {
  const { t } = useLanguage();
  return (
    <SetupFocusComparison {...props} focus="alignment" question={t.setups.alignment.engineerQuestion}>
      {(rows, ask) => (
        <Panel title={t.setups.alignment.title}>
          <AlignmentEngineeringView comparison={compareAlignment(rows)} engineer={ask} />
        </Panel>
      )}
    </SetupFocusComparison>
  );
}
