'use client';

import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';

// Live Racing's incident count for the focused driver (iRacing's PlayerCarMyIncidentCount). When it goes up, the
// number grows big and flashes three times (animate-incident-flash in globals.css), then goes back to normal. A new
// driver, or the first count seen, doesn't flash.
export default function LiveIncidents({ driverId, incidents }: { driverId: number; incidents: number | null }) {
  const { t, fmt } = useLanguage();
  const previous = useRef<{ driverId: number; incidents: number | null } | null>(null);
  // Changes each time the count goes up, restarting the animation
  const [flash, setFlash] = useState(0);
  const [flashing, setFlashing] = useState(false);

  useEffect(() => {
    const before = previous.current;
    previous.current = { driverId, incidents };
    if (before?.driverId === driverId && before.incidents != null && incidents != null && incidents > before.incidents) {
      setFlash((n) => n + 1);
      setFlashing(true);
    }
  }, [driverId, incidents]);

  return (
    <div className="flex flex-col items-center gap-1 min-w-16">
      <span
        key={flash}
        onAnimationEnd={() => setFlashing(false)}
        className={`inline-block text-4xl font-extrabold leading-none tabular-nums ${
          flashing ? 'animate-incident-flash text-red-400' : 'text-foreground'
        }`}
      >
        {incidents == null ? '—' : fmt(t.liveRacing.incidentCount, { n: incidents })}
      </span>
      <span className="text-xs text-muted-foreground">{t.liveRacing.incidents}</span>
    </div>
  );
}
