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
//   racingcoach-lighting color RRGGBB[WW]      every unprotected zone in one color
//   racingcoach-lighting mode automatic|manual|disabled|test
//   racingcoach-lighting test pit-limiter on|off|toggle
//   racingcoach-lighting test flag yellow|red|green|checkered [on|off|toggle]
//   racingcoach-lighting all-off | all-on
//   racingcoach-lighting streamdeck list|install|uninstall   the 32-key Stream Deck profile's button apps
//   any command --notify                      also show the answer as a macOS notification
//   racingcoach-lighting restore baseline|defaults
//   racingcoach-lighting controllers | controller-test <id>
//   racingcoach-lighting ui                   open the local page in the browser
//   racingcoach-lighting diagnostics          the last few hundred events, rule decisions and controller requests
//
// The site address: RC_LIGHTING_SITE, else https://racingcoach.app. Commands other than run, pair and unpair talk to
// the running agent on 127.0.0.1:8750 with the local token, so no credential is ever in a Stream Deck button.

import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { keyIconPng } from './lib/keyIcon.ts';
import { LOCAL_PORT, hexColor, startLocalApi } from './lib/localApi.ts';
import { deleteDeviceToken, homeDir, isMac, localToken, logDir, makeLogger, readDeviceToken, readJson } from './lib/platform.ts';
import { MockProvider } from './lib/providers.ts';
import { cacheConfig, LightingRuntime, loadConfig } from './lib/runtime.ts';
import { defaultConfig, parseLightingConfig, type LightingConfig, type Zone } from '../src/lib/lighting/model.ts';
import { FLAG_TESTS, streamDeckAppleScript, streamDeckAppName, streamDeckLayout } from '../src/lib/lighting/streamDeckLayout.ts';
import { pairDevice, SiteConnection } from './lib/site.ts';
import { WledProvider } from './lib/wled.ts';

const AGENT_VERSION = '0.2.0';
const SITE = process.env.RC_LIGHTING_SITE ?? 'https://racingcoach.app';

// --notify: the answer also goes up as a macOS notification (a Stream Deck key has nowhere to print it).
// RC_LIGHTING_BUTTON=1 (set by the button apps): failures always do
const argv = process.argv.slice(2);
const notifyAnswer = argv.includes('--notify');
const fromButton = process.env.RC_LIGHTING_BUTTON === '1';
const [command = 'help', ...args] = argv.filter((a) => a !== '--notify');

function notify(text: string) {
  if (!isMac) return;
  // The text goes in as an argument, never into the script, so nothing in it is run
  execFileSync('/usr/bin/osascript', ['-e', 'on run argv', '-e', 'display notification (item 1 of argv) with title "RacingCoach Lighting"', '-e', 'end run', text.slice(0, 240)]);
}

const BUTTONS_DIR = join(process.env.HOME ?? homeDir(), 'Applications', 'RacingCoach Lighting Buttons');
const BUTTONS_MARKER = '.racingcoach-lighting-buttons';

// The zones for the zone keys: the running agent's (the site's configuration), else config.json, else the defaults
async function zonesForButtons(): Promise<Pick<Zone, 'id' | 'name'>[]> {
  const running = (await local('GET', '/zones').catch(() => null)) as { zones?: Pick<Zone, 'id' | 'name'>[] } | null;
  if (running?.zones?.length) return running.zones;
  const saved = parseLightingConfig(readJson<unknown>(join(homeDir(), 'config.json')));
  return saved.ok ? saved.config.zones : defaultConfig().zones;
}

// One app per key (an AppleScript applet that runs the command with no window or Dock icon) and its key icon, in
// ~/Applications/RacingCoach Lighting Buttons, made again from scratch each time (docs/lighting/STREAM_DECK.md)
async function installButtons(dir: string, print: (text: string) => void) {
  if (!isMac) throw new Error('streamdeck install builds macOS apps: run it on the Mac');
  if (existsSync(dir) && !existsSync(join(dir, BUTTONS_MARKER))) throw new Error(`${dir} exists and isn't a RacingCoach buttons folder; pick another`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'Icons'), { recursive: true });
  writeFileSync(join(dir, BUTTONS_MARKER), `Made by racingcoach-lighting streamdeck install; removed by streamdeck uninstall\n`);
  const commandPath = join(import.meta.dirname, 'bin', 'racingcoach-lighting');
  const keys = streamDeckLayout(await zonesForButtons());
  const work = mkdtempSync(join(tmpdir(), 'rc-lighting-'));
  const lines: string[] = [];
  try {
    for (const key of keys) {
      const name = streamDeckAppName(key);
      const app = join(dir, `${name}.app`);
      const script = join(work, `${name}.applescript`);
      writeFileSync(script, streamDeckAppleScript(commandPath, key.args));
      execFileSync('/usr/bin/osacompile', ['-o', app, script]);
      // No Dock icon while it runs; editing Info.plist breaks the applet's signature, so it's signed again (ad hoc)
      execFileSync('/usr/bin/plutil', ['-replace', 'LSUIElement', '-bool', 'YES', join(app, 'Contents', 'Info.plist')]);
      execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', app], { stdio: 'ignore' });
      writeFileSync(join(dir, 'Icons', `${name}.png`), keyIconPng(key.icon));
      lines.push(`Row ${key.row + 1}, key ${key.col + 1}: ${key.title.padEnd(22)} ${name}.app   racingcoach-lighting ${key.args.join(' ')}`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  writeFileSync(join(dir, 'Layout.txt'), lines.join('\n') + '\n');
  print(lines.join('\n'));
  print(`\n${keys.length} button apps and key icons in ${dir}`);
  print('In Stream Deck: drag System > Open onto each key, choose its app, set the Title, and Set from File the icon in Icons.');
}

function printLayout(zones: Pick<Zone, 'id' | 'name'>[], print: (text: string) => void) {
  for (const key of streamDeckLayout(zones)) print(`Row ${key.row + 1}, key ${key.col + 1}: ${key.title.padEnd(22)} racingcoach-lighting ${key.args.join(' ')}`);
}

type Status = {
  mode: string;
  scene: string;
  allOff: boolean;
  masterBrightness: number;
  site: string;
  telemetryFresh: boolean;
  activeOverride: string | null;
  controllers: { id: string; online: boolean }[];
};

// One line for a notification: mode, scene, override, brightness, site, controllers
function statusLine(s: Status): string {
  const online = s.controllers.filter((c) => c.online).length;
  return [
    s.mode[0] + s.mode.slice(1).toLowerCase(),
    s.allOff ? 'all off' : `scene ${s.scene}`,
    s.activeOverride ? `event ${s.activeOverride}` : null,
    `${Math.round(s.masterBrightness * 100)}%`,
    `site ${s.site}`,
    `${online}/${s.controllers.length} controllers online`,
  ]
    .filter(Boolean)
    .join(' · ');
}

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
  // One provider per controller of the configuration, made again when the configuration changes
  const buildProviders = (controllers: LightingConfig['controllers']) => {
    runtime.providers.clear();
    for (const controller of controllers) {
      if (mock) runtime.providers.set(controller.id, new MockProvider(controller, 20));
      else {
        if (!controller.host) log('warn', `Controller ${controller.id} has no address yet: set it on the Admin page (Lighting Control)`);
        runtime.providers.set(controller.id, new WledProvider(controller, (entry) => log('debug', `WLED ${entry.kind}`, { controller: entry.controllerId, ...entry.detail })));
      }
    }
  };
  buildProviders(config.controllers);

  // The site's configuration is the authoritative one: fetched when its version differs from the cached one. When the
  // site has none yet, this Mac's config.json is uploaded once, so what was set here isn't lost
  let syncing = false;
  let uploaded = false;
  const syncConfig = async (siteVersion: number) => {
    if (syncing) return;
    // The site has none yet: this Mac's goes up once (its version stays 0, so the next heartbeat fetches the site's)
    if (siteVersion === 0) {
      if (uploaded) return;
      uploaded = true;
    } else if (siteVersion === runtime.config.version) return;
    syncing = true;
    try {
      if (siteVersion === 0) {
        const version = await site.uploadConfig({ ...runtime.config, version: 0 });
        if (version !== null) log('info', `Uploaded this Mac's lighting configuration to the site (version ${version})`);
        return;
      }
      const answer = await site.fetchConfig();
      if (!answer?.config) return;
      const parsed = parseLightingConfig(answer.config);
      if (!parsed.ok) {
        log('error', 'The site’s lighting configuration was refused', { problems: parsed.problems });
        return;
      }
      cacheConfig(parsed.config);
      buildProviders(parsed.config.controllers);
      runtime.applyConfig(parsed.config);
    } catch (error) {
      if (siteVersion === 0) uploaded = false;
      log('warn', 'Configuration sync failed; trying again with the next heartbeat', { error: error instanceof Error ? error.message : String(error) });
    } finally {
      syncing = false;
    }
  };

  const site = new SiteConnection(SITE, log, {
    onSnapshot: (snapshot) => runtime.onSnapshot(snapshot),
    onEvent: (event) => runtime.onEvent(event),
    onHeartbeat: (heartbeat, at) => runtime.onHeartbeat(heartbeat, at),
    onStatus: (status) => runtime.onSiteStatus(status),
    agentStatus: () => runtime.siteReport(AGENT_VERSION),
    onConfigVersion: (version) => void syncConfig(version),
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

const onOffToggle = (value: string | undefined) => (value === 'on' ? { active: true } : value === 'off' ? { active: false } : { toggle: true });

function testAnswer(name: string, answer: { active: boolean; ruleEnabled: boolean }, ruleHint: string): string {
  const text = `Test ${name} ${answer.active ? 'on' : 'off'}`;
  return answer.ruleEnabled ? text : `${text}, but no enabled rule follows it: turn on the ${ruleHint} rule on the Admin page (Lighting Control > Configuration)`;
}

async function main() {
  const print = (text: string) => {
    console.log(text);
    if (notifyAnswer) notify(text);
  };
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
    case 'status': {
      const status = (await local('GET', '/status')) as Status;
      if (notifyAnswer) notify(statusLine(status));
      return console.log(JSON.stringify(status, null, 2));
    }
    case 'color': {
      if (!args[0] || !hexColor(args[0])) throw new Error('color RRGGBB[WW]');
      await local('POST', '/color', { color: args[0] });
      return print(`Color ${args[0].toUpperCase()}`);
    }
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
    case 'test': {
      const usage = 'test pit-limiter on|off|toggle, or test flag yellow|red|green|checkered [on|off|toggle]';
      if (args[0] === 'pit-limiter' && ['on', 'off', 'toggle'].includes(args[1])) {
        const answer = (await local('POST', '/test/pit-limiter', onOffToggle(args[1]))) as { active: boolean; ruleEnabled: boolean };
        return print(testAnswer('pit limiter', answer, 'Pit limiter'));
      }
      const flag = args[0] === 'flag' ? FLAG_TESTS[args[1] as keyof typeof FLAG_TESTS] : undefined;
      if (!flag || (args[2] !== undefined && !['on', 'off', 'toggle'].includes(args[2]))) throw new Error(usage);
      const answer = (await local('POST', '/test/event', { event: flag, ...onOffToggle(args[2]) })) as { active: boolean; ruleEnabled: boolean };
      return print(testAnswer(`${args[1]} flag`, answer, `${args[1][0].toUpperCase()}${args[1].slice(1)} flag`));
    }
    case 'streamdeck': {
      const dir = args[1] ?? BUTTONS_DIR;
      if (args[0] === 'list') return printLayout(await zonesForButtons(), console.log);
      if (args[0] === 'install') return installButtons(dir, console.log);
      if (args[0] === 'uninstall') {
        if (!existsSync(join(dir, BUTTONS_MARKER))) throw new Error(`No RacingCoach buttons folder at ${dir}`);
        rmSync(dir, { recursive: true, force: true });
        return console.log(`Removed ${dir}`);
      }
      throw new Error('streamdeck list|install|uninstall [folder]');
    }
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
      print('Commands: run [--mock], pair, unpair, status, scene, zone, color, brightness, mode, test, all-off, all-on, restore, controllers, controller-test, diagnostics, ui, streamdeck');
      print(`Files: ${homeDir()} (config.json, state.json); log: ${join(logDir(), 'agent.log')}`);
  }
}

main().catch((error) => {
  const text = error instanceof Error ? error.message : String(error);
  console.error(text);
  if (fromButton || notifyAnswer) {
    try {
      notify(text);
    } catch {
      // Nothing more can be done from a key press
    }
  }
  process.exitCode = 1;
});
