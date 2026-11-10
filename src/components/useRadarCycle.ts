'use client';

import { useEffect, useState } from 'react';
import { radarShowing } from '@/lib/liveCarStatus';

// Whether the weather radar is on screen now: while wet, for RADAR_SHOW_MS of every RADAR_EVERY_MS on the clock
// (clockOffset: the server's clock minus this one, so every TV changes together), never while held (e.g. a recorded
// clip is playing on the TV)
export function useRadarCycle(wet: boolean, held = false, clockOffset = 0): boolean {
  const [showing, setShowing] = useState(false);
  useEffect(() => {
    if (!wet || held) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- off as soon as it's dry
      setShowing(false);
      return;
    }
    const tick = () => setShowing(radarShowing(Date.now() + clockOffset));
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [wet, held, clockOffset]);
  return showing;
}
