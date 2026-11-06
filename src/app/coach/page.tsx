import CoachInstructionsEditor from '@/components/CoachInstructionsEditor';
import ExpertLapsManager from '@/components/ExpertLapsManager';
import SimulatorMappings from '@/components/SimulatorMappings';
import SubscribersLinkCard from '@/components/SubscribersLinkCard';
import TrackMaintenance from '@/components/TrackMaintenance';
import { listExpertLaps } from '@/lib/expertLaps';
import { getDictionary, getLanguage } from '@/lib/i18n/server';
import { canCoach } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import {
  getCoachInstructions,
  getHeadCoachInCarInstructions,
  getSetupEngineerInstructions,
  MAX_COACH_INSTRUCTIONS,
} from '@/lib/siteSettings';
import { MAPPABLE_SIMULATORS } from '@/lib/simulatorCatalogs';
import { listTracksForMaintenance } from '@/lib/trackMaintenance';

// The Coach page: a link to Subscribers (src/components/SubscribersLinkCard.tsx), Expert Laps
// (src/components/ExpertLapsManager.tsx), the Setup Engineer Instructions every driver's Setup Engineer follows
// (src/lib/setupEngineer.ts), the AI Coach Instructions every driver's AI coaching follows (src/lib/siteSettings.ts), the
// In-Car AI Coach Instructions every driver's In-Car AI Coach follows, then Track and Focus Area Maintenance
// (src/components/TrackMaintenance.tsx), then Simulator Mapping (src/components/SimulatorMappings.tsx), which links other
// simulators' tracks and cars to the site's.
// Only Coaches and Admins can use it; anyone else (signed in or not) gets a message saying so.
export default async function CoachPage() {
  const user = await getCurrentUser();
  const dictionary = getDictionary(await getLanguage(user));
  const t = dictionary.coach;
  const allowed = user !== null && canCoach(user.role);
  const [expertLaps, setupInstructions, instructions, inCarInstructions, tracks] = allowed
    ? await Promise.all([
        listExpertLaps(),
        getSetupEngineerInstructions(),
        getCoachInstructions(),
        getHeadCoachInCarInstructions(),
        listTracksForMaintenance(),
      ])
    : [[], '', '', '', []];

  return (
    <section className="py-10 px-4">
      <div className="site-container space-y-6">
        <h1 className="text-3xl font-bold bg-gradient-to-r from-primary-strong via-primary to-primary-strong bg-clip-text text-transparent">
          {t.pageTitle}
        </h1>
        {allowed ? (
          <>
            <SubscribersLinkCard t={dictionary.subscribers} />
            <ExpertLapsManager expertLaps={expertLaps} />
            <CoachInstructionsEditor instructions={setupInstructions} maxLength={MAX_COACH_INSTRUCTIONS} setup />
            <CoachInstructionsEditor instructions={instructions} maxLength={MAX_COACH_INSTRUCTIONS} />
            <CoachInstructionsEditor instructions={inCarInstructions} maxLength={MAX_COACH_INSTRUCTIONS} inCar />
            <TrackMaintenance tracks={tracks} />
            <SimulatorMappings simulators={MAPPABLE_SIMULATORS} />
          </>
        ) : (
          <p role="status" className="bg-secondary rounded-xl border border-border p-4 sm:p-6 text-foreground">
            {t.noAccess}
          </p>
        )}
      </div>
    </section>
  );
}
