// The volume of the telemetry collector's brake beeps ("Users".brake_beeps_volume), the slider under "Beeps before
// braking" in the collector's window: a whole percentage of full volume, which the collector plays in decibels
// (BrakeBeeps.Gain).
export const MIN_BRAKE_BEEPS_VOLUME = 10;
export const MAX_BRAKE_BEEPS_VOLUME = 100;
// A new account's volume
export const DEFAULT_BRAKE_BEEPS_VOLUME = 62;

export function isBrakeBeepsVolume(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_BRAKE_BEEPS_VOLUME &&
    value <= MAX_BRAKE_BEEPS_VOLUME
  );
}
