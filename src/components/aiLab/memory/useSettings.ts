'use client';

import { useCallback, useEffect, useState } from 'react';
import type { MemoryConfig } from '@/lib/memory/rules';
import { memApi } from './memoryUi';

// The service's settings for the settings sections: a draft the Admin edits, saved in one PUT (the server merges
// it with what's stored and audits every change)

export type SettingsResponse = {
  config: MemoryConfig;
  defaults: MemoryConfig;
  effects: Record<string, 'reembed' | 'restart' | 'approval' | null>;
  applications: { key: string; settings: { mode?: string | null } }[];
  users: { key: string; settings: { mode?: string | null } }[];
};

export function useSettings() {
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [draft, setDraft] = useState<MemoryConfig | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const load = useCallback(async () => {
    try {
      const r = await memApi<SettingsResponse>('/settings');
      setData(r);
      setDraft(r.config);
    } catch (e) {
      setError(e);
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads once
    void load();
  }, [load]);
  const save = useCallback(
    async (config: Partial<MemoryConfig>, scoped?: { type: 'application' | 'user'; key: string; mode: string | null }) => {
      setError(null);
      setSaved(false);
      try {
        await memApi('/settings', { method: 'PUT', body: { config, scoped } });
        await load();
        setSaved(true);
      } catch (e) {
        setError(e);
      }
    },
    [load]
  );
  return { data, draft, setDraft, error, saved, save, reload: load };
}
