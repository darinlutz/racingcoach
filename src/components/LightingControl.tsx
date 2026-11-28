'use client';

import { useCallback, useEffect, useState } from 'react';
import { useConfirm } from '@/components/ConfirmProvider';
import LightingConfigEditor from '@/components/LightingConfigEditor';
import { useLanguage } from '@/components/LanguageProvider';
import type { AgentStatus } from '@/lib/lighting/agentStatus';
import type { LightingDeviceRow } from '@/lib/lighting/devices';
import type { LightingSnapshot } from '@/lib/lighting/hub';
import { defaultConfig } from '@/lib/lighting/model';
import { streamDeckLayout } from '@/lib/lighting/streamDeckLayout';

// Lighting Control's tabs (src/app/admin/lighting/page.tsx, docs/lighting/README.md): Dashboard, Agents &
// Controllers, Configuration (LightingConfigEditor.tsx), Test Lab and Stream Deck. Everything comes from GET /api/admin/lighting/devices, read every 2 s: the
// paired agents with their last heartbeat, and the driver's lighting state. Controller addresses never come here.

type Device = LightingDeviceRow & { status: AgentStatus | null };
type Tab = 'dashboard' | 'agents' | 'configuration' | 'testLab' | 'streamDeck';
const TABS: Tab[] = ['dashboard', 'agents', 'configuration', 'testLab', 'streamDeck'];
// An agent heartbeats every 5 s
const ONLINE_MS = 15_000;

const COMMANDS = [
  'racingcoach-lighting status',
  'racingcoach-lighting scene race|garage|broadcast|night|white|blue|red|off',
  'racingcoach-lighting zone cockpit toggle',
  'racingcoach-lighting zone cockpit color 0000FF',
  'racingcoach-lighting zone cockpit brightness 128',
  'racingcoach-lighting brightness increase|decrease|<percent>',
  'racingcoach-lighting mode automatic|manual|test|disabled',
  'racingcoach-lighting color 00FF00',
  'racingcoach-lighting test pit-limiter on|off|toggle',
  'racingcoach-lighting test flag yellow|red|green|checkered [on|off|toggle]',
  'racingcoach-lighting all-off | all-on',
  'racingcoach-lighting restore baseline|defaults',
  'racingcoach-lighting controllers',
  'racingcoach-lighting controller-test main',
  'racingcoach-lighting diagnostics',
  'racingcoach-lighting ui',
  'racingcoach-lighting streamdeck list|install|uninstall',
  'racingcoach-lighting status --notify',
];

// The 32-key layout (4 rows of 8) the agent's streamdeck install builds, shown with the default zones (the Mac's
// streamdeck list shows the installation's own)
const LAYOUT = streamDeckLayout(defaultConfig().zones);

// Black or white text, whichever reads on the key's color
const keyText = (hex: string) => {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#000000' : '#FFFFFF';
};

const secondsAgo = (ms: number) => Math.max(0, Math.round(ms / 1000));

export default function LightingControl() {
  const { t, fmt } = useLanguage();
  const l = t.lightingControl;
  const ask = useConfirm();
  const [tab, setTab] = useState<Tab>('dashboard');
  const [devices, setDevices] = useState<Device[]>([]);
  const [snapshot, setSnapshot] = useState<LightingSnapshot | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/lighting/devices', { cache: 'no-store' });
      if (!res.ok) return;
      const data = (await res.json()) as { devices: Device[]; snapshot: LightingSnapshot };
      setDevices(data.devices);
      setSnapshot(data.snapshot);
      setNow(Date.now());
    } catch {
      // the next read tries again
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the first read, then every 2 s
    void load();
    const timer = setInterval(() => void load(), 2000);
    return () => clearInterval(timer);
  }, [load]);

  const errorText = (codeName: unknown) => l.errors[(typeof codeName === 'string' && codeName in l.errors ? codeName : 'failed') as keyof typeof l.errors];

  const approve = async () => {
    setError('');
    setMessage('');
    setBusy(true);
    try {
      const res = await fetch('/api/admin/lighting/devices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(errorText(data.code));
      else {
        setMessage(fmt(l.agents.approved, { name: data.deviceName }));
        setCode('');
        await load();
      }
    } catch {
      setError(l.errors.failed);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (device: Device) => {
    if (!(await ask.confirm({ message: fmt(l.agents.confirmRemove, { name: device.name }), action: 'delete' }))) return;
    await fetch(`/api/admin/lighting/devices/${device.id}`, { method: 'DELETE' }).catch(() => null);
    await load();
  };

  const sendTest = async (event: string, label: string) => {
    setError('');
    const res = await fetch('/api/admin/lighting/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event }) }).catch(() => null);
    if (!res?.ok) setError(errorText((await res?.json().catch(() => ({})))?.code));
    else setMessage(fmt(l.testLab.sent, { event: label }));
    await load();
  };

  const d = l.dashboard;
  const online = (device: Device) => !!device.status && now - device.status.receivedAt < ONLINE_MS;
  const agent = devices.find(online) ?? devices[0] ?? null;
  const live = snapshot?.live ?? null;
  const limiterText = (value: boolean | null | undefined) => (value === true ? d.on : value === false ? d.off : d.unknown);
  const card = 'rounded-xl border border-border bg-card p-4';
  const label = 'text-[11px] font-semibold uppercase tracking-widest text-muted-foreground';
  const button = 'rounded-md border border-border px-3 py-1.5 text-sm font-semibold text-foreground hover:border-primary disabled:opacity-50';
  const code$ = 'block whitespace-pre-wrap break-all rounded-md bg-secondary px-3 py-2 font-mono text-xs text-foreground';

  return (
    <div className="mt-6 space-y-4">
      <div role="tablist" className="flex flex-wrap gap-2 border-b border-border pb-2">
        {TABS.map((key) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`rounded-md px-3 py-1.5 text-sm font-semibold uppercase tracking-wide ${tab === key ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground'}`}
          >
            {l.tabs[key]}
          </button>
        ))}
      </div>
      {message && <p role="status" className="text-sm text-good-text">{message}</p>}
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}

      {tab === 'dashboard' && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <div className={card}>
            <p className={label}>{d.agent}</p>
            {agent ? (
              <>
                <p className="mt-1 flex items-center gap-2 text-lg font-bold text-foreground">
                  <span className={`size-2.5 rounded-full ${online(agent) ? 'bg-green-500' : 'bg-muted-foreground'}`} />
                  {agent.name} · {online(agent) ? d.online : d.offline}
                </p>
                {agent.status && <p className="text-xs text-muted-foreground">{fmt(d.heartbeat, { seconds: secondsAgo(now - agent.status.receivedAt) })}</p>}
                <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <dt className="text-muted-foreground">{d.mode}</dt>
                  <dd className="font-semibold text-foreground">{agent.status?.mode ?? '—'}</dd>
                  <dt className="text-muted-foreground">{d.scene}</dt>
                  <dd className="font-semibold text-foreground">{agent.status?.scene ?? '—'}</dd>
                  <dt className="text-muted-foreground">{d.override}</dt>
                  <dd className={`font-semibold ${agent.status?.activeOverride ? 'text-blue-400' : 'text-foreground'}`}>{agent.status?.activeOverride ?? d.none}</dd>
                  <dt className="text-muted-foreground">{d.latency}</dt>
                  <dd className="font-semibold text-foreground">{agent.status?.lastEventLatencyMs != null ? `${agent.status.lastEventLatencyMs} ms` : '—'}</dd>
                </dl>
              </>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">{d.noAgent}</p>
            )}
          </div>

          <div className={card}>
            <p className={label}>{d.session}</p>
            {live ? (
              <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
                <dt className="text-muted-foreground">{d.simulator}</dt>
                <dd className="font-semibold text-foreground">{live.simulator}</dd>
                <dt className="text-muted-foreground">{d.pitLimiter}</dt>
                <dd>
                  <span className={`rounded px-2 py-0.5 text-xs font-bold ${live.pitLimiterActive && live.fresh ? 'bg-blue-600 text-white' : 'bg-secondary text-muted-foreground'}`}>
                    {limiterText(live.pitLimiterActive)}
                  </span>
                </dd>
                <dt className="text-muted-foreground">{d.telemetry}</dt>
                <dd className={`font-semibold ${live.fresh ? 'text-good-text' : 'text-amber-400'}`}>{live.fresh ? fmt(d.fresh, { ms: live.telemetryAgeMs }) : d.stale}</dd>
              </dl>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">{d.noSession}</p>
            )}
          </div>

          <div className={card}>
            <p className={label}>{d.controllers}</p>
            <ul className="mt-2 space-y-2 text-sm">
              {(agent?.status?.controllers ?? []).map((c) => (
                <li key={c.id} className="flex items-center gap-2">
                  <span className={`size-2.5 rounded-full ${c.online ? 'bg-green-500' : 'bg-red-500'}`} />
                  <span className="font-semibold text-foreground">{c.name}</span>
                  <span className="text-muted-foreground">
                    {c.online ? d.online : d.offline}
                    {c.firmware ? ` · ${fmt(l.agents.firmware, { version: c.firmware })}` : ''}
                    {c.latencyMs != null ? ` · ${c.latencyMs} ms` : ''}
                    {c.lastAckMs != null ? ` · ${fmt(d.lastAck, { seconds: secondsAgo(c.lastAckMs) })}` : ''}
                  </span>
                </li>
              ))}
              {!agent?.status?.controllers.length && <li className="text-muted-foreground">—</li>}
            </ul>
          </div>
        </div>
      )}

      {tab === 'agents' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className={card}>
            <h2 className="font-semibold text-foreground">{l.agents.pairTitle}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{l.agents.pairHelp}</p>
            <label htmlFor="lighting-code" className={`mt-3 block ${label}`}>{l.agents.codeLabel}</label>
            <div className="mt-1 flex gap-2">
              <input
                id="lighting-code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="K7PR-4MXT"
                autoComplete="off"
                spellCheck={false}
                maxLength={12}
                className="w-40 rounded-md border border-border bg-background px-3 py-1.5 font-mono text-sm tracking-widest text-foreground"
              />
              <button type="button" disabled={busy || code.replace(/[\s-]/g, '').length !== 8} onClick={() => void approve()} className={button}>
                {l.agents.approve}
              </button>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">{l.agents.controllersNote}</p>
          </div>
          <div className={card}>
            <h2 className="font-semibold text-foreground">{l.agents.paired}</h2>
            <ul className="mt-2 divide-y divide-border text-sm">
              {devices.map((device) => (
                <li key={device.id} className="flex flex-wrap items-center gap-2 py-2">
                  <span className={`size-2.5 rounded-full ${online(device) ? 'bg-green-500' : 'bg-muted-foreground'}`} />
                  <span className="font-semibold text-foreground">{device.name}</span>
                  <span className="text-muted-foreground">
                    {device.agentVersion ? fmt(l.agents.version, { version: device.agentVersion }) : ''} ·{' '}
                    {fmt(l.agents.lastSeen, { when: device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleString() : l.agents.never })}
                  </span>
                  <button type="button" onClick={() => void remove(device)} className={`${button} ml-auto`}>
                    {l.agents.remove}
                  </button>
                </li>
              ))}
              {!devices.length && <li className="py-2 text-muted-foreground">{l.agents.none}</li>}
            </ul>
          </div>
        </div>
      )}

      {tab === 'configuration' && <LightingConfigEditor />}

      {tab === 'testLab' && (
        <div className={card}>
          <p className="text-sm text-muted-foreground">{l.testLab.intro}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => void sendTest('pitLimiterOn', l.testLab.pitOn)} className={`${button} border-blue-500 text-blue-300`}>{l.testLab.pitOn}</button>
            <button type="button" onClick={() => void sendTest('pitLimiterOff', l.testLab.pitOff)} className={button}>{l.testLab.pitOff}</button>
            <button type="button" onClick={() => void sendTest('sessionStart', l.testLab.sessionStart)} className={button}>{l.testLab.sessionStart}</button>
            <button type="button" onClick={() => void sendTest('sessionEnd', l.testLab.sessionEnd)} className={button}>{l.testLab.sessionEnd}</button>
          </div>
          <p className={`mt-4 ${label}`}>{l.testLab.testState}</p>
          <p className="text-sm text-foreground">
            {d.pitLimiter}: {limiterText(snapshot?.test?.pitLimiterActive)}
          </p>
          <p className="mt-4 text-xs text-muted-foreground">{l.testLab.localNote}</p>
        </div>
      )}

      {tab === 'streamDeck' && (
        <div className="space-y-4">
          <div className={card}>
            <p className="text-sm text-muted-foreground">{l.streamDeck.intro}</p>
            <h2 className="mt-4 font-semibold text-foreground">{l.streamDeck.install}</h2>
            <code className={`mt-2 ${code$}`}>{'cd ~/path/to/racingcoach\nlighting-agent/install.sh\nracingcoach-lighting pair\nracingcoach-lighting streamdeck install'}</code>
            <h2 className="mt-4 font-semibold text-foreground">{l.streamDeck.commands}</h2>
            <code className={`mt-2 ${code$}`}>{COMMANDS.join('\n')}</code>
            <h2 className="mt-4 font-semibold text-foreground">{l.streamDeck.buttons}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{l.streamDeck.buttonSteps}</p>
          </div>
          <div className={card}>
            <h2 className="font-semibold text-foreground">{l.streamDeck.layout}</h2>
            <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-8">
              {LAYOUT.map((key) => (
                <div
                  key={`${key.row}-${key.col}`}
                  title={`racingcoach-lighting ${key.args.join(' ')}`}
                  className="flex aspect-square items-center justify-center rounded-lg border border-border p-1 text-center font-mono text-[10px] leading-tight"
                  style={{ backgroundColor: `#${key.icon}`, color: keyText(key.icon) }}
                >
                  {key.args.filter((a) => a !== '--notify').join(' ')}
                </div>
              ))}
            </div>
          </div>
          <div className={card}>
            <h2 className="font-semibold text-foreground">{l.streamDeck.troubleshooting}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{l.streamDeck.troubleSteps}</p>
          </div>
        </div>
      )}
    </div>
  );
}
