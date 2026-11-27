'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import { RULE_EVENTS, SUPPORTED_RULE_EVENTS, type LightingConfig, type Rgbw, type ZoneLook } from '@/lib/lighting/model';

// Lighting Control's Configuration tab (docs/lighting/README.md, Phase 10): controllers, zones, scenes, event rules
// and settings, edited as a draft and saved whole (PUT /api/admin/lighting/config) with the version it was read at, so
// a save over someone else's is refused rather than lost. The server checks it with the same parser the agent uses.

const hex = (c: Rgbw) => '#' + c.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join('');
const fromHex = (value: string, white: number): Rgbw => [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16)).concat(white) as Rgbw;
const slug = (name: string, taken: string[]) => {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'item';
  let id = base;
  for (let i = 2; taken.includes(id); i++) id = `${base}-${i}`;
  return id;
};

const input = 'rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground';
const small = `${input} w-20`;
const label = 'block text-[11px] font-semibold uppercase tracking-widest text-muted-foreground';
const button = 'rounded-md border border-border px-3 py-1.5 text-sm font-semibold text-foreground hover:border-primary disabled:opacity-50';
const section = 'rounded-xl border border-border bg-card p-4 space-y-3';

function LookEditor({ look, onChange }: { look: Partial<ZoneLook>; onChange: (look: Partial<ZoneLook>) => void }) {
  const { t } = useLanguage();
  const c = t.lightingControl.config;
  const color = look.color ?? [0, 0, 0, 255];
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <label className="flex items-center gap-1.5">
        <input type="checkbox" checked={look.on !== false} onChange={(e) => onChange({ ...look, on: e.target.checked })} />
        {c.on}
      </label>
      <label className="flex items-center gap-1.5">
        {c.color}
        <input type="color" value={hex(color)} onChange={(e) => onChange({ ...look, color: fromHex(e.target.value, color[3]) })} className="h-7 w-10 rounded border border-border bg-transparent" />
      </label>
      <label className="flex items-center gap-1.5">
        {c.white}
        <input type="range" min={0} max={255} value={color[3]} onChange={(e) => onChange({ ...look, color: [color[0], color[1], color[2], Number(e.target.value)] })} />
      </label>
      <label className="flex items-center gap-1.5">
        {c.brightness}
        <input type="range" min={0} max={255} value={look.brightness ?? 128} onChange={(e) => onChange({ ...look, brightness: Number(e.target.value) })} />
        <span className="w-8 text-right tabular-nums text-muted-foreground">{look.brightness ?? 128}</span>
      </label>
    </div>
  );
}

export default function LightingConfigEditor() {
  const { t, fmt } = useLanguage();
  const c = t.lightingControl.config;
  const [config, setConfig] = useState<LightingConfig | null>(null);
  const [version, setVersion] = useState(0);
  const [saved, setSaved] = useState(true);
  const [message, setMessage] = useState('');
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/lighting/config', { cache: 'no-store' }).catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as { version: number; config: LightingConfig; saved: boolean };
    setConfig(data.config);
    setVersion(data.version);
    setSaved(data.saved);
    setProblems([]);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads the configuration once
    void load();
  }, [load]);

  if (!config) return null;
  const update = (change: Partial<LightingConfig>) => setConfig({ ...config, ...change });

  const save = async () => {
    setBusy(true);
    setMessage('');
    setProblems([]);
    try {
      const res = await fetch('/api/admin/lighting/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedVersion: version, config }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setVersion(data.version);
        setSaved(true);
        setConfig({ ...config, version: data.version });
        setMessage(fmt(c.saved, { version: data.version }));
      } else if (res.status === 409) setMessage(fmt(c.conflict, { version: data.currentVersion }));
      else setProblems(Array.isArray(data.problems) ? data.problems : [t.lightingControl.errors.failed]);
    } finally {
      setBusy(false);
    }
  };

  const ids = (list: { id: string }[]) => list.map((x) => x.id);

  return (
    <div className="space-y-4">
      <div className={section}>
        <p className="text-sm text-muted-foreground">{c.intro}</p>
        {!saved && <p className="text-sm text-amber-400">{c.notSaved}</p>}
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" disabled={busy} onClick={() => void save()} className={`${button} border-primary bg-primary text-white`}>
            {c.save}
          </button>
          <button type="button" disabled={busy} onClick={() => void load()} className={button}>
            {c.reload}
          </button>
          <span className="text-xs text-muted-foreground">{fmt(c.version, { version })}</span>
        </div>
        {message && <p role="status" className="text-sm text-foreground">{message}</p>}
        {problems.length > 0 && (
          <div role="alert" className="text-sm text-red-400">
            <p>{c.problems}</p>
            <ul className="list-disc pl-5">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className={section}>
        <h2 className="font-semibold text-foreground">{c.controllers}</h2>
        {config.controllers.map((ctl, i) => (
          <div key={i} className="flex flex-wrap items-end gap-3">
            <label>
              <span className={label}>{c.name}</span>
              <input className={input} value={ctl.name} onChange={(e) => update({ controllers: config.controllers.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
            </label>
            <label>
              <span className={label}>{c.key}</span>
              <input className={`${input} w-28 font-mono`} value={ctl.id} readOnly />
            </label>
            <label>
              <span className={label}>{c.address}</span>
              <input
                className={`${input} w-44 font-mono`}
                value={ctl.host}
                placeholder="192.168.1.50"
                spellCheck={false}
                onChange={(e) => update({ controllers: config.controllers.map((x, j) => (j === i ? { ...x, host: e.target.value.trim() } : x)) })}
              />
            </label>
            <label>
              <span className={label}>{c.port}</span>
              <input
                type="number"
                className={small}
                value={ctl.port}
                onChange={(e) => update({ controllers: config.controllers.map((x, j) => (j === i ? { ...x, port: Number(e.target.value) } : x)) })}
              />
            </label>
            <button
              type="button"
              disabled={config.controllers.length <= 1}
              className={button}
              onClick={() => update({ controllers: config.controllers.filter((_, j) => j !== i), zones: config.zones.filter((z) => z.controllerId !== ctl.id) })}
            >
              {c.remove}
            </button>
          </div>
        ))}
        <p className="text-xs text-muted-foreground">{c.addressHint}</p>
        <button
          type="button"
          className={button}
          onClick={() => update({ controllers: [...config.controllers, { id: slug('controller', ids(config.controllers)), name: 'Controller', host: '', port: 80 }] })}
        >
          {c.add}
        </button>
      </div>

      <div className={section}>
        <h2 className="font-semibold text-foreground">{c.zones}</h2>
        <p className="text-xs text-muted-foreground">{c.protectedHint}</p>
        {config.zones.map((zone, i) => {
          const set = (change: Partial<typeof zone>) => update({ zones: config.zones.map((x, j) => (j === i ? { ...x, ...change } : x)) });
          return (
            <div key={i} className="flex flex-wrap items-end gap-3 border-t border-border pt-3">
              <label>
                <span className={label}>{c.name}</span>
                <input className={input} value={zone.name} onChange={(e) => set({ name: e.target.value })} />
              </label>
              <label>
                <span className={label}>{c.controller}</span>
                <select className={input} value={zone.controllerId} onChange={(e) => set({ controllerId: e.target.value })}>
                  {config.controllers.map((ctl) => (
                    <option key={ctl.id} value={ctl.id}>
                      {ctl.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className={label}>{c.segment}</span>
                <input type="number" min={0} max={31} className={small} value={zone.segmentId} onChange={(e) => set({ segmentId: Number(e.target.value) })} />
              </label>
              <label>
                <span className={label}>{c.maxBrightness}</span>
                <input type="range" min={0} max={255} value={zone.maxBrightness} onChange={(e) => set({ maxBrightness: Number(e.target.value) })} />
              </label>
              {(['enabled', 'automatic', 'protected'] as const).map((flag) => (
                <label key={flag} className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" checked={zone[flag]} onChange={(e) => set({ [flag]: e.target.checked })} />
                  {c[flag]}
                </label>
              ))}
              <button
                type="button"
                className={button}
                onClick={() =>
                  update({
                    zones: config.zones.filter((_, j) => j !== i),
                    scenes: config.scenes.map((s) => ({ ...s, zones: Object.fromEntries(Object.entries(s.zones).filter(([k]) => k !== zone.id)) })),
                    rules: config.rules.map((r) => (r.zones === 'automatic' ? r : { ...r, zones: r.zones.filter((z) => z !== zone.id) })),
                  })
                }
              >
                {c.remove}
              </button>
            </div>
          );
        })}
        <button
          type="button"
          className={button}
          onClick={() =>
            update({
              zones: [
                ...config.zones,
                {
                  id: slug('zone', ids(config.zones)),
                  name: 'Zone',
                  controllerId: config.controllers[0].id,
                  segmentId: Math.max(-1, ...config.zones.map((z) => z.segmentId)) + 1,
                  enabled: false,
                  maxBrightness: 200,
                  automatic: true,
                  protected: false,
                },
              ],
            })
          }
        >
          {c.add}
        </button>
      </div>

      <div className={section}>
        <h2 className="font-semibold text-foreground">{c.scenes}</h2>
        {config.scenes.map((scene, i) => (
          <div key={i} className="space-y-2 border-t border-border pt-3">
            <div className="flex flex-wrap items-end gap-3">
              <label>
                <span className={label}>{c.name}</span>
                <input className={input} value={scene.name} onChange={(e) => update({ scenes: config.scenes.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
              </label>
              <span className="font-mono text-xs text-muted-foreground">{scene.id}</span>
              <button type="button" disabled={scene.id === config.startScene} className={button} onClick={() => update({ scenes: config.scenes.filter((_, j) => j !== i) })}>
                {c.remove}
              </button>
            </div>
            <p className={label}>{c.allZones}</p>
            <LookEditor look={scene.all ?? {}} onChange={(look) => update({ scenes: config.scenes.map((x, j) => (j === i ? { ...x, all: look } : x)) })} />
          </div>
        ))}
        <button
          type="button"
          className={button}
          onClick={() => update({ scenes: [...config.scenes, { id: slug('scene', ids(config.scenes)), name: 'Scene', zones: {}, all: { on: true, color: [0, 0, 0, 255], brightness: 128, effect: 0 } }] })}
        >
          {c.add}
        </button>
      </div>

      <div className={section}>
        <h2 className="font-semibold text-foreground">{c.rules}</h2>
        {config.rules.map((rule, i) => {
          const set = (change: Partial<typeof rule>) => update({ rules: config.rules.map((x, j) => (j === i ? { ...x, ...change } : x)) });
          const supported = SUPPORTED_RULE_EVENTS.includes(rule.event);
          return (
            <div key={i} className="space-y-2 border-t border-border pt-3">
              <div className="flex flex-wrap items-end gap-3">
                <label>
                  <span className={label}>{c.name}</span>
                  <input className={input} value={rule.name} onChange={(e) => set({ name: e.target.value })} />
                </label>
                <label>
                  <span className={label}>{c.event}</span>
                  <select className={input} value={rule.event} onChange={(e) => set({ event: e.target.value as typeof rule.event })}>
                    {RULE_EVENTS.map((ev) => (
                      <option key={ev} value={ev}>
                        {c.events[ev]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className={label}>{c.priority}</span>
                  <input type="number" min={1} max={1000} className={small} value={rule.priority} onChange={(e) => set({ priority: Number(e.target.value) })} />
                </label>
                <label>
                  <span className={label}>{c.duration}</span>
                  <input type="number" min={0} max={3600} className={small} value={rule.durationSeconds} onChange={(e) => set({ durationSeconds: Number(e.target.value) })} />
                </label>
                <label className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" checked={rule.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
                  {c.enabled}
                </label>
                {!supported && <span className="text-xs text-amber-400">{c.unsupported}</span>}
                <button type="button" className={button} onClick={() => update({ rules: config.rules.filter((_, j) => j !== i) })}>
                  {c.remove}
                </button>
              </div>
              <LookEditor look={rule.look} onChange={(look) => set({ look })} />
              <div className="flex flex-wrap gap-3 text-sm">
                <span className={label}>{c.targets}</span>
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={rule.zones === 'automatic'} onChange={(e) => set({ zones: e.target.checked ? 'automatic' : [] })} />
                  {c.allAutomatic}
                </label>
                {rule.zones !== 'automatic' &&
                  config.zones.map((zone) => (
                    <label key={zone.id} className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={(rule.zones as string[]).includes(zone.id)}
                        onChange={(e) => set({ zones: e.target.checked ? [...(rule.zones as string[]), zone.id] : (rule.zones as string[]).filter((z) => z !== zone.id) })}
                      />
                      {zone.name}
                    </label>
                  ))}
              </div>
            </div>
          );
        })}
        <button
          type="button"
          className={button}
          onClick={() =>
            update({
              rules: [
                ...config.rules,
                { id: slug('rule', ids(config.rules)), name: 'Rule', event: 'pitLimiter', enabled: false, priority: 5, zones: 'automatic', look: { on: true, color: [0, 0, 255, 0], brightness: 128, effect: 0 }, durationSeconds: 0 },
              ],
            })
          }
        >
          {c.add}
        </button>
      </div>

      <div className={section}>
        <h2 className="font-semibold text-foreground">{c.settings}</h2>
        <div className="flex flex-wrap items-end gap-4">
          <label>
            <span className={label}>{c.staleTelemetry}</span>
            <input
              type="number"
              min={1}
              max={60}
              className={small}
              value={config.settings.staleTelemetryMs / 1000}
              onChange={(e) => update({ settings: { ...config.settings, staleTelemetryMs: Math.round(Number(e.target.value) * 1000) } })}
            />
          </label>
          <label>
            <span className={label}>{c.masterBrightness}</span>
            <input
              type="number"
              min={0}
              max={100}
              className={small}
              value={Math.round(config.settings.masterBrightness * 100)}
              onChange={(e) => update({ settings: { ...config.settings, masterBrightness: Number(e.target.value) / 100 } })}
            />
          </label>
          <label>
            <span className={label}>{c.minChange}</span>
            <input
              type="number"
              min={0}
              max={5000}
              className={small}
              value={config.settings.minChangeIntervalMs}
              onChange={(e) => update({ settings: { ...config.settings, minChangeIntervalMs: Number(e.target.value) } })}
            />
          </label>
          <label>
            <span className={label}>{c.fade}</span>
            <input
              type="number"
              min={0}
              max={60000}
              className={small}
              value={config.settings.defaultTransitionMs}
              onChange={(e) => update({ settings: { ...config.settings, defaultTransitionMs: Number(e.target.value) } })}
            />
          </label>
          <label>
            <span className={label}>{c.startScene}</span>
            <select className={input} value={config.startScene} onChange={(e) => update({ startScene: e.target.value })}>
              {config.scenes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
    </div>
  );
}
