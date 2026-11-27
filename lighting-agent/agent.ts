// RacingCoach Lighting Agent: runs on the Mac, follows the driver's live session on RacingCoach.app and drives the
// sim room's WLED controllers; Stream Deck buttons control it through this same command (docs/lighting/README.md,
// docs/lighting/MAC_INSTALL.md). No npm packages: Node 22.18 or later runs this TypeScript file directly.
//
//   racingcoach-lighting run [--mock]         the agent itself (the LaunchAgent runs this); --mock: no controllers
//   racingcoach-lighting pair [--name NAME]   pair with RacingCoach.app (prints a code to approve on the Admin page)
//   racingcoach-lighting unpair               forget the device token (and revoke it on the site)
//   racingcoach-lighting status               the agent's mode, scene, zones, controllers and latency
//   racingcoach-lighting scene <id>           race, garage, broadcast, night, white, blue, red, off, or your own
//   racingcoach-lighting zone <id> toggle|on|off|color RRGGBB[WW]|brightness 0-255
//   racingcoach-lighting brightness increase|decrease|<percent>
//   racingcoach-lighting mode automatic|manual|disabled|test
//   racingcoach-lighting test pit-limiter on|off
//   racingcoach-lighting all-off | all-on
//   racingcoach-lighting restore baseline|defaults
//   racingcoach-lighting controllers | controller-test <id>
//   racingcoach-lighting ui                   open the local page in the browser
//   racingcoach-lighting diagnostics          the last few hundred events, rule decisions and controller requests
//
// The site address: RC_LIGHTING_SITE, else https://racingcoach.app. Commands other than run, pair and unpair talk to
// the running agent on 127.0.0.1:8750 with the local token, so no credential is ever in a Stream Deck button.

import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { LOCAL_PORT, hexColor, startLocalApi } from './lib/localApi.ts';
import { deleteDeviceToken, homeDir, isMac, localToken, logDir, makeLogger, readDeviceToken } from './lib/platform.ts';
import { MockProvider } from './lib/providers.ts';
import { LightingRuntime, loadConfig } from './lib/runtime.ts';
import { pairDevice, SiteConnection } from './lib/site.ts';
import { WledProvider } from './lib/wled.ts';

const AGENT_VERSION = '0.1.0';
const SITE = process.env.RC_LIGHTING_SITE ?? 'https://racingcoach.app';

const [command = 'help', ...args] = process.argv.slice(2);

async function local(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
  const response = await fetch(`http://127.0.0.1:${LOCAL_PORT}${path}`, {
    method,
    headers: { Authorization: `Bearer ${localToken()}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  }).catch(() => {
    throw new Error('The lighting agent isn’t running (racingcoach-lighting run, or its LaunchAgent).');
  });
  const answer = (await response.json()) as { error?: string };
  if (!response.ok) throw new Error(answer.error ?? `HTTP ${response.status}`);
  return answer;
}

function run(mock: boolean) {
  const log = makeLogger();
  const config = loadConfig(log);
  const runtime = new LightingRuntime(config, log);
  for (const controller of config.controllers) {
    if (mock) runtime.providers.set(controller.id, new MockProvider(controller, 20));
    else {
      if (!controller.host) log('warn', `Controller ${controller.id} has no address yet: set it in config.json or on the Admin page`);
      runtime.providers.set(controller.id, new WledProvider(controller, (entry) => log('debug', `WLED ${entry.kind}`, { controller: entry.controllerId, ...entry.detail })));
    }
  }
  const site = new SiteConnection(SITE, log, {
    onSnapshot: (snapshot) => runtime.onSnapshot(snapshot),
    onEvent: (event) => runtime.onEvent(event),
    onHeartbeat: (heartbeat, at) => runtime.onHeartbeat(heartbeat, at),
    onStatus: (status) => runtime.onSiteStatus(status),
    agentStatus: () => runtime.siteReport(AGENT_VERSION),
  });
  const server = startLocalApi(runtime, localToken(), AGENT_VERSION);
  server.on('error', (error) => {
    log('error', `The local API couldn't start on 127.0.0.1:${LOCAL_PORT}`, { error: error.message });
    process.exit(1);
  });
  runtime.start();
  site.start();
  void runtime.apply(true);
  log('info', `RacingCoach Lighting Agent ${AGENT_VERSION} running${mock ? ' with mock controllers' : ''}`, { site: SITE, home: homeDir(), local: `127.0.0.1:${LOCAL_PORT}` });
  const shutdown = () => {
    log('info', 'Stopping');
    site.stop();
    runtime.stop();
    server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

function zoneChange(action: string | undefined, value: string | undefined): Record<string, unknown> {
  if (action === 'toggle') return { toggle: true };
  if (action === 'on' || action === 'off') return { on: action === 'on' };
  if (action === 'color' && value && hexColor(value)) return { color: value };
  if (action === 'brightness' && value && /^\d{1,3}$/.test(value) && Number(value) <= 255) return { brightness: Number(value) };
  throw new Error('zone <id> toggle|on|off|color RRGGBB[WW]|brightness 0-255');
}

async function main() {
  const print = (text: string) => console.log(text);
  switch (command) {
    case 'run':
      return run(args.includes('--mock') || process.env.RC_LIGHTING_MOCK === '1');
    case 'pair': {
      const nameAt = args.indexOf('--name');
      const ok = await pairDevice(SITE, nameAt >= 0 ? args[nameAt + 1] : undefined, print);
      process.exitCode = ok ? 0 : 1;
      return;
    }
    case 'unpair': {
      const deviceToken = await readDeviceToken();
      if (deviceToken) {
        const token = await fetch(new URL('/api/lighting/devices/token', SITE), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceToken }),
        }).then((r) => (r.ok ? (r.json() as Promise<{ accessToken: string }>) : null)).catch(() => null);
        if (token) await fetch(new URL('/api/lighting/devices/revoke', SITE), { method: 'POST', headers: { Authorization: `Bearer ${token.accessToken}` } }).catch(() => null);
      }
      await deleteDeviceToken();
      return print('Unpaired. Restart the agent, then run pair to connect it again.');
    }
    case 'status':
      return print(JSON.stringify(await local('GET', '/status'), null, 2));
    case 'scene':
      if (!args[0]) throw new Error('scene <id>');
      await local('POST', `/scenes/${encodeURIComponent(args[0])}/activate`, {});
      return print(`Scene ${args[0]}`);
    case 'zone':
      if (!args[0]) throw new Error('zone <id> ...');
      await local('POST', `/zones/${encodeURIComponent(args[0])}/state`, zoneChange(args[1], args[2]));
      return print('OK');
    case 'brightness': {
      const action = args[0];
      const answer = (await local(
        'POST',
        '/brightness',
        action === 'increase' || action === 'decrease' ? { action } : /^\d{1,3}$/.test(action ?? '') ? { percent: Number(action) } : {}
      )) as { masterBrightness: number };
      return print(`Brightness ${Math.round(answer.masterBrightness * 100)}%`);
    }
    case 'mode':
      await local('POST', '/mode', { mode: args[0] });
      return print(`Mode ${String(args[0]).toUpperCase()}`);
    case 'test':
      if (args[0] !== 'pit-limiter' || !['on', 'off'].includes(args[1])) throw new Error('test pit-limiter on|off');
      await local('POST', '/test/pit-limiter', { active: args[1] === 'on' });
      return print(`Test pit limiter ${args[1]}`);
    case 'all-off':
    case 'all-on':
      await local('POST', `/${command}`, {});
      return print(command === 'all-off' ? 'All off' : 'All on');
    case 'restore':
      await local('POST', '/restore', { what: args[0] === 'defaults' ? 'defaults' : 'baseline' });
      return print(`Restored ${args[0] === 'defaults' ? 'defaults' : 'baseline'}`);
    case 'controllers':
      return print(JSON.stringify(await local('GET', '/controllers'), null, 2));
    case 'controller-test':
      return print(JSON.stringify(await local('POST', `/controllers/${encodeURIComponent(args[0] ?? '')}/test`, {}), null, 2));
    case 'diagnostics':
      return print(JSON.stringify(await local('GET', '/diagnostics'), null, 2));
    case 'ui': {
      const url = `http://127.0.0.1:${LOCAL_PORT}/#token=${localToken()}`;
      if (isMac) execFile('/usr/bin/open', [url]);
      else print(url);
      return;
    }
    default:
      print('RacingCoach Lighting Agent ' + AGENT_VERSION);
      print('Commands: run [--mock], pair, unpair, status, scene, zone, brightness, mode, test, all-off, all-on, restore, controllers, controller-test, diagnostics, ui');
      print(`Files: ${homeDir()} (config.json, state.json); log: ${join(logDir(), 'agent.log')}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
