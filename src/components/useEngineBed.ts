'use client';

import { useEffect } from 'react';
import { engineBed } from '@/lib/engineBed';
import type { EngineBedConfig } from '@/lib/engineBedConfig';

// Sets up the page's engine bed (src/lib/engineBed.ts) with the listener's preferences, ready to unlock at their first
// click or key press, and frees it when the page goes away. level is the page's own volume and mute, 0-1.
export function useEngineBed(config: EngineBedConfig, level = 1): void {
  useEffect(() => {
    engineBed.armUnlock();
    return () => engineBed.shutdown();
  }, []);
  useEffect(() => {
    engineBed.configure(config);
  }, [config]);
  useEffect(() => {
    engineBed.setLevel(level);
  }, [level]);
}
