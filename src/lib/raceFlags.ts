// The flag Live Racing shows for a session, from iRacing's SessionFlags bits and SessionState, which the collector
// sends with each live update from 1.54.0. SessionFlags mixes the session's flag (green, yellow, white, checkered,
// ...) with the driver's own (blue, black, repair, disqualified), so they're split here: the session's flag is shown
// big at the top of the page, the driver's beside it.

// iRacing's irsdk_Flags
export const SESSION_FLAG_BITS = {
  checkered: 0x0001,
  white: 0x0002,
  green: 0x0004,
  yellow: 0x0008,
  red: 0x0010,
  blue: 0x0020,
  debris: 0x0040,
  crossed: 0x0080,
  yellowWaving: 0x0100,
  oneLapToGreen: 0x0200,
  greenHeld: 0x0400,
  tenToGo: 0x0800,
  fiveToGo: 0x1000,
  randomWaving: 0x2000,
  caution: 0x4000,
  cautionWaving: 0x8000,
  black: 0x010000,
  disqualify: 0x020000,
  servicible: 0x040000,
  furled: 0x080000,
  repair: 0x100000,
  startHidden: 0x10000000,
  startReady: 0x20000000,
  startSet: 0x40000000,
  startGo: 0x80000000,
} as const;

// iRacing's irsdk_SessionState
export const SESSION_STATES = ['invalid', 'getInCar', 'warmup', 'parade', 'racing', 'checkered', 'coolDown'] as const;
export type SessionStateName = (typeof SESSION_STATES)[number];

// The flags drawn: the session's (green to none) and the driver's (blue to disqualify)
export type FlagKind =
  | 'green'
  | 'yellow'
  | 'caution'
  | 'red'
  | 'white'
  | 'checkered'
  | 'debris'
  | 'none'
  | 'blue'
  | 'black'
  | 'repair'
  | 'disqualify';

// What's said under the session's flag, e.g. "One lap to green", "Last lap"
export type FlagNote = 'lastLap' | 'oneLapToGreen' | 'tenToGo' | 'fiveToGo' | 'halfway' | 'getReady' | 'go' | SessionStateName;

export type SessionFlag = {
  flag: FlagKind;
  // The flag is waved (a yellow waved for danger close by, a full-course caution waved as it's thrown)
  waving: boolean;
  notes: FlagNote[];
  // The driver's own flags (the collector's driver, not the whole field)
  driverFlags: FlagKind[];
};

const has = (bits: number, flag: number) => (bits & flag) !== 0;

// The session's flag from SessionFlags (unsigned, 0 to 2^32 - 1) and SessionState; null when neither was sent
// (collectors before 1.54.0)
export function sessionFlag(bits: number | null | undefined, state: number | null | undefined): SessionFlag | null {
  if (bits == null && state == null) return null;
  const b = bits ?? 0;
  const F = SESSION_FLAG_BITS;
  const stateName = state != null ? SESSION_STATES[state] ?? null : null;
  const notes: FlagNote[] = [];

  let flag: FlagKind;
  let waving = false;
  if (has(b, F.checkered)) flag = 'checkered';
  else if (has(b, F.red)) flag = 'red';
  else if (has(b, F.caution) || has(b, F.cautionWaving)) {
    flag = 'caution';
    waving = has(b, F.cautionWaving);
  } else if (has(b, F.yellow) || has(b, F.yellowWaving)) {
    flag = 'yellow';
    waving = has(b, F.yellowWaving);
  } else if (has(b, F.white)) flag = 'white';
  else if (has(b, F.debris)) flag = 'debris';
  else if (has(b, F.green) || has(b, F.greenHeld) || has(b, F.startGo)) flag = 'green';
  else if (stateName === 'racing') flag = 'green';
  else if (stateName === 'checkered' || stateName === 'coolDown') flag = 'checkered';
  else flag = 'none';

  // Under a caution the white flag means the last lap too, so it's said rather than drawn
  if (has(b, F.white) && flag !== 'white') notes.push('lastLap');
  if (has(b, F.oneLapToGreen)) notes.push('oneLapToGreen');
  if (has(b, F.tenToGo)) notes.push('tenToGo');
  if (has(b, F.fiveToGo)) notes.push('fiveToGo');
  if (has(b, F.crossed)) notes.push('halfway');
  if (has(b, F.startReady) || has(b, F.startSet)) notes.push('getReady');
  else if (has(b, F.startGo) && stateName !== 'racing') notes.push('go');
  if (flag === 'none' && stateName && stateName !== 'invalid' && stateName !== 'racing') notes.push(stateName);

  const driverFlags: FlagKind[] = [];
  if (has(b, F.disqualify)) driverFlags.push('disqualify');
  if (has(b, F.black)) driverFlags.push('black');
  if (has(b, F.repair)) driverFlags.push('repair');
  if (has(b, F.blue)) driverFlags.push('blue');

  return { flag, waving, notes, driverFlags };
}
