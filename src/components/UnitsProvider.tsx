'use client';

import { createContext, useContext } from 'react';
import { DEFAULT_UNITS, type Units } from '@/lib/units';

const UnitsContext = createContext<Units>(DEFAULT_UNITS);

// Gives client components the user's Preferred Units (Standard or Metric). The root layout picks them on
// the server (src/lib/unitsServer.ts) and wraps the whole site in this; src/lib/units.ts converts with them.
export default function UnitsProvider({ units, children }: { units: Units; children: React.ReactNode }) {
  return <UnitsContext.Provider value={units}>{children}</UnitsContext.Provider>;
}

export function useUnits(): Units {
  return useContext(UnitsContext);
}
