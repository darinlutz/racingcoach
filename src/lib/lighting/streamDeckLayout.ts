import type { Zone } from './model.ts';

// The 32-key Stream Deck lighting profile (Stream Deck XL: 4 rows of 8; docs/lighting/STREAM_DECK.md), shared by the
// Mac agent (racingcoach-lighting streamdeck install builds one button app and key icon per key) and the Admin page's
// Stream Deck tab, which shows it. Pure, no I/O. Each key is one racingcoach-lighting command; the titles are the
// English names the agent gives the button apps and Stream Deck shows on the keys (the Mac side is English, like the
// collector's log).

export type StreamDeckKey = {
  row: number;
  col: number;
  title: string;
  // The racingcoach-lighting arguments
  args: string[];
  // The key icon's background, RRGGBB
  icon: string;
};

export const STREAM_DECK_ROWS = 4;
export const STREAM_DECK_COLS = 8;
// Row 3 has room for this many zones; the rest of a bigger installation is reached with zone <id> commands
export const STREAM_DECK_ZONE_KEYS = 6;

export const FLAG_TESTS = { yellow: 'yellowFlag', red: 'redFlag', green: 'greenFlag', checkered: 'checkeredFlag' } as const;

type KeyDef = Omit<StreamDeckKey, 'row' | 'col'>;

const MODE = '1F2937';
const k = (title: string, args: string[], icon: string): KeyDef => ({ title, args, icon });

// Every zone of the configuration gets a key, enabled or not yet (a zone is enabled once it's wired), the first six
export function streamDeckLayout(zones: Pick<Zone, 'id' | 'name'>[]): StreamDeckKey[] {
  const zoneKeys = zones
    .slice(0, STREAM_DECK_ZONE_KEYS)
    .map((z) => k(z.name, ['zone', z.id, 'toggle'], '374151'));
  while (zoneKeys.length < STREAM_DECK_ZONE_KEYS) zoneKeys.push(k('Status', ['status', '--notify'], MODE));

  const rows: KeyDef[][] = [
    [
      k('Automatic', ['mode', 'automatic'], '15803D'),
      k('Manual', ['mode', 'manual'], 'B45309'),
      k('Test Mode', ['mode', 'test'], '7C3AED'),
      k('Disabled', ['mode', 'disabled'], '4B5563'),
      k('All On', ['all-on'], 'F5F5F4'),
      k('All Off', ['all-off'], '000000'),
      k('Dimmer', ['brightness', 'decrease'], '57534E'),
      k('Brighter', ['brightness', 'increase'], 'D6D3D1'),
    ],
    [
      k('Race', ['scene', 'race'], 'E5E7EB'),
      k('Garage', ['scene', 'garage'], 'FFFFFF'),
      k('Broadcast', ['scene', 'broadcast'], '1D4ED8'),
      k('Night', ['scene', 'night'], 'C2410C'),
      k('White', ['scene', 'white'], 'FAFAF9'),
      k('Blue', ['scene', 'blue'], '0000FF'),
      k('Red', ['scene', 'red'], 'FF0000'),
      k('Scene Off', ['scene', 'off'], '111111'),
    ],
    [...zoneKeys, k('Green', ['color', '00FF00'], '00FF00'), k('Amber', ['color', 'FFB400'], 'FFB400')],
    [
      k('Pit Limiter Test', ['test', 'pit-limiter', 'toggle', '--notify'], '0050FF'),
      k('Yellow Flag Test', ['test', 'flag', 'yellow', 'toggle', '--notify'], 'FFD000'),
      k('Red Flag Test', ['test', 'flag', 'red', 'toggle', '--notify'], 'DC2626'),
      k('Purple', ['color', '8000FF'], '8000FF'),
      k('Restore Baseline', ['restore', 'baseline'], '0F766E'),
      k('Restore Defaults', ['restore', 'defaults', '--notify'], '134E4A'),
      k('Status', ['status', '--notify'], MODE),
      k('Lighting Page', ['ui'], '0E7490'),
    ],
  ];
  return rows.flatMap((row, r) => row.map((key, c) => ({ ...key, row: r, col: c })));
}

// The button app's file name: sorted by position, e.g. "07 Brighter"
export function streamDeckAppName(key: StreamDeckKey): string {
  const n = String(key.row * STREAM_DECK_COLS + key.col + 1).padStart(2, '0');
  return `${n} ${key.title.replace(/[/:]/g, '-')}`;
}

// The AppleScript of a button app: runs the command with no Terminal window. RC_LIGHTING_BUTTON=1 makes a failure a
// macOS notification (there's no window to print it in); --notify does the same for the answer. Every argument is
// quoted for the shell, then the whole command for AppleScript, so a zone or scene id can never become a second command
export function streamDeckAppleScript(commandPath: string, args: string[]): string {
  const shell = 'RC_LIGHTING_BUTTON=1 ' + [commandPath, ...args].map((a) => `'${a.replace(/'/g, `'\\''`)}'`).join(' ');
  const applescript = shell.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `try\n  do shell script "${applescript}"\nend try\n`;
}
