'use client';

import { useLanguage } from '@/components/LanguageProvider';
import SetupFocusComparison from '@/components/SetupFocusComparison';
import TireEngineeringView from '@/components/TireEngineeringView';
import { compareTires } from '@/lib/tiresGeometry';

type Props = Omit<Parameters<typeof SetupFocusComparison>[0], 'focus' | 'question' | 'children'>;

// The Setups page's Tires tab (docs/setups.md): the two revisions Compare has, drawn by TireEngineeringView. Keyed by
// the pair, so the pressure unit picked starts from the new pair's own
export default function SetupTires(props: Props) {
  const { t } = useLanguage();
  return (
    <SetupFocusComparison {...props} focus="tires" question={t.setups.tires.engineerQuestion}>
      {(rows, ask) => (
        <TireEngineeringView key={`${props.value.a?.revisionId}:${props.value.b?.revisionId}`} comparison={compareTires(rows)} engineer={ask} />
      )}
    </SetupFocusComparison>
  );
}
