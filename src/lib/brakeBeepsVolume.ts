// The volume of the telemetry collector's brake beeps ("Users".brake_beeps_volume), the slider under "Play beeps
// before braking" on the Account page: a whole percentage of full volume. No imports, so client components can use it.
export const MIN_BRAKE_BEEPS_VOLUME = 10;
export const MAX_BRAKE_BEEPS_VOLUME = 100;

export function isBrakeBeepsVolume(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_BRAKE_BEEPS_VOLUME &&
    value <= MAX_BRAKE_BEEPS_VOLUME
  );
}

// Loudness is heard on a log scale, so the slider moves in decibels rather than amplitude: 100% is full volume and
// each step of 10 below it is 4 dB quieter (50% is -20 dB, a tenth of full amplitude; 10% is -36 dB). The
// collector's BrakeBeeps.Gain does the same, so keep the two identical.
export const BRAKE_BEEPS_RANGE_DB = 40;

// A slider volume (10-100) as the amplitude to play at, 0-1 of full
export function brakeBeepsGain(volume: number): number {
  return 10 ** ((((volume - MAX_BRAKE_BEEPS_VOLUME) / MAX_BRAKE_BEEPS_VOLUME) * BRAKE_BEEPS_RANGE_DB) / 20);
}
