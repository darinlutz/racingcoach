'use client';

import AeroDashboard from '@/components/AeroDashboard';
import DrivetrainDashboard from '@/components/DrivetrainDashboard';
import ElectronicsDashboard from '@/components/ElectronicsDashboard';
import FuelDashboard from '@/components/FuelDashboard';
import { useLanguage } from '@/components/LanguageProvider';
import OtherDashboard from '@/components/OtherDashboard';
import SetupFocusComparison from '@/components/SetupFocusComparison';
import { compareDashboard, type SetupDashboard } from '@/lib/setupDashboards';

type Props = Omit<Parameters<typeof SetupFocusComparison>[0], 'focus' | 'question' | 'children'> & { dashboard: SetupDashboard };

const VIEWS = { aero: AeroDashboard, drivetrain: DrivetrainDashboard, fuel: FuelDashboard, electronics: ElectronicsDashboard, other: OtherDashboard };

// The Setups page's Aerodynamics, Drivetrain, Fuel, Electronics and Other tabs (docs/setups.md): the two revisions
// Compare has, the category's parameters (setupDashboards.ts) drawn by that dashboard. Keyed by the pair and the
// dashboard so each starts fresh
export default function SetupDashboardTab({ dashboard, ...props }: Props) {
  const { t } = useLanguage();
  const View = VIEWS[dashboard];
  return (
    <SetupFocusComparison {...props} focus={dashboard} question={t.setups.dashboards[dashboard].engineerQuestion}>
      {(rows, ask) => (
        <View key={`${dashboard}:${props.value.a?.revisionId}:${props.value.b?.revisionId}`} comparison={compareDashboard(dashboard, rows)} engineer={ask} />
      )}
    </SetupFocusComparison>
  );
}
