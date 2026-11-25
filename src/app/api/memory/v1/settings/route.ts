import { ApiError, body, memoryRoute } from '@/lib/memory/api';
import { DEFAULT_CONFIG, MEMORY_MODES, SETTING_EFFECTS } from '@/lib/memory/rules';
import { getConfig, listScoped, saveConfig, setScoped } from '@/lib/memory/store';

// GET: the service's settings, the defaults, which settings need a re-embed, restart or approval, and the
// per-application and per-user modes. PUT: { config } and/or { scoped: { type, key, mode } } (Admins only).
export const GET = memoryRoute({ scope: 'memory:admin' }, async () => ({
  config: await getConfig(),
  defaults: DEFAULT_CONFIG,
  effects: SETTING_EFFECTS,
  applications: await listScoped('application'),
  users: await listScoped('user'),
}));

export const PUT = memoryRoute({ scope: 'memory:admin', perMinute: 60 }, async (request, caller) => {
  const b = await body(request, 32 * 1024);
  const out: Record<string, unknown> = {};
  if (b.config && typeof b.config === 'object') out.saved = await saveConfig(b.config, caller.actor);
  const s = b.scoped as { type?: string; key?: string; mode?: string | null } | undefined;
  if (s) {
    if ((s.type !== 'application' && s.type !== 'user') || typeof s.key !== 'string' || !/^[a-z0-9-]{1,40}$/.test(s.key)) throw new ApiError(400, 'invalid', 'scoped needs type and key');
    if (s.mode !== null && !(MEMORY_MODES as readonly unknown[]).includes(s.mode)) throw new ApiError(400, 'invalid', 'Unknown mode');
    await setScoped(s.type, s.key, { mode: s.mode }, caller.actor);
  }
  return { ...out, config: await getConfig() };
});
