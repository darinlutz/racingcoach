import ExpertLapsManager from '@/components/ExpertLapsManager';
import SimulatorMappings from '@/components/SimulatorMappings';
import SubscribersLinkCard from '@/components/SubscribersLinkCard';
import TrackMaintenance from '@/components/TrackMaintenance';
import { listExpertLaps } from '@/lib/expertLaps';
import { getDictionary, getLanguage } from '@/lib/i18n/server';
import { canCoach } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import { MAPPABLE_SIMULATORS } from '@/lib/simulatorCatalogs';
import { listTracksForMaintenance } from '@/lib/trackMaintenance';

// The Coach page: a link to Subscribers (src/components/SubscribersLinkCard.tsx), Expert Laps
// (src/components/ExpertLapsManager.tsx), then Track and Focus Area Maintenance
// (src/components/TrackMaintenance.tsx), then Simulator Mapping (src/components/SimulatorMappings.tsx), which links other
// simulators' tracks and cars to the site's.
// How the coaches and the Setup Engineer work is built in (src/lib/coachingGuidance.ts), not written here.
// Only Coaches and Admins can use it; anyone else (signed in or not) gets a message saying so.
export default async function CoachPage() {
  const user = await getCurrentUser();
  const dictionary = getDictionary(await getLanguage(user));
  const t = dictionary.coach;
  const allowed = user !== null && canCoach(user.role);
  const [expertLaps, tracks] = allowed ? await Promise.all([listExpertLaps(), listTracksForMaintenance()]) : [[], []];

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
