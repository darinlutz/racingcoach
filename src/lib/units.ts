// The site's measurement units. Shared by server and client code: the user's choice is
// racingcoach."Users".units, or the UNITS_COOKIE for visitors who aren't signed in.
// Standard shows feet, mph and °F; Metric shows meters, kph and °C. Data keeps its own units (Track Data in feet,
// telemetry in meters and m/s, temperatures in °C); these convert it for display and back from what users type.

export const UNITS = ['standard', 'metric'] as const;
export type Units = (typeof UNITS)[number];

export const DEFAULT_UNITS: Units = 'standard';

// Remembers the units in the browser too, so they stay after signing out
export const UNITS_COOKIE = 'units';

export function isUnits(value: unknown): value is Units {
  return typeof value === 'string' && (UNITS as readonly string[]).includes(value);
}

export const METERS_PER_FOOT = 0.3048;
const MPH_PER_METER_PER_SECOND = 2.23694;
const KPH_PER_METER_PER_SECOND = 3.6;

// The symbols shown after a number
export const DISTANCE_UNIT: Record<Units, string> = { standard: 'ft', metric: 'm' };
export const SPEED_UNIT: Record<Units, string> = { standard: 'mph', metric: 'kph' };
export const TEMPERATURE_UNIT: Record<Units, string> = { standard: '°F', metric: '°C' };

// How the AI features name them in prompts
export const DISTANCE_NAME: Record<Units, string> = { standard: 'feet', metric: 'meters' };

// Feet (Track Data's brake and throttle points, track lengths) -> feet or meters
export function distanceFromFeet(feet: number, units: Units): number {
  return units === 'metric' ? feet * METERS_PER_FOOT : feet;
}

// Feet or meters typed by the user -> feet, as Track Data stores them
export function feetFromDistance(value: number, units: Units): number {
  return units === 'metric' ? value / METERS_PER_FOOT : value;
}

// Meters (telemetry, track positions) -> feet or meters
export function distanceFromMeters(meters: number, units: Units): number {
  return units === 'metric' ? meters : meters / METERS_PER_FOOT;
}

// m/s (iRacing's Speed) -> mph or kph
export function speedFromMetersPerSecond(metersPerSecond: number, units: Units): number {
  return metersPerSecond * (units === 'metric' ? KPH_PER_METER_PER_SECOND : MPH_PER_METER_PER_SECOND);
}

// mph (as Debrief Coach sessions store speeds) -> mph or kph
export function speedFromMph(mph: number, units: Units): number {
  return speedFromMetersPerSecond(mph / MPH_PER_METER_PER_SECOND, units);
}

const NEWTON_METERS_PER_LB_FT = 1.3558179483;

// Car Data's torque: stored in lb-ft, shown in lb-ft or Nm
export const TORQUE_UNIT: Record<Units, string> = { standard: 'lb-ft', metric: 'Nm' };

// lb-ft (Car Data) -> lb-ft or Nm
export function torqueFromLbFt(lbFt: number, units: Units): number {
  return units === 'metric' ? lbFt * NEWTON_METERS_PER_LB_FT : lbFt;
}

// lb-ft or Nm typed by the user -> lb-ft, as Car Data stores it
export function lbFtFromTorque(value: number, units: Units): number {
  return units === 'metric' ? value / NEWTON_METERS_PER_LB_FT : value;
}

// °C (iRacing's temperatures) -> °F or °C
export function temperatureFromCelsius(celsius: number, units: Units): number {
  return units === 'metric' ? celsius : (celsius * 9) / 5 + 32;
}

// A brakepoint change the coaches tell the driver, already in the user's units: feet to the nearest 5
// (22 -> 20, 48 -> 50), meters to whole meters
export function roundBrakeChange(distance: number, units: Units): number {
  return units === 'metric' ? Math.round(distance) : Math.round(distance / 5) * 5;
}

// A driving line offset the coaches tell the driver, already in the user's units: whole feet (2.1 -> 2),
// meters to one decimal as a meter is too coarse for a line
export function roundLineOffset(distance: number, units: Units): string {
  return units === 'metric' ? distance.toFixed(1) : Math.round(distance).toFixed(0);
}

// 1234.4 ft -> "1,234 ft" (or "376 m"), rounded to whole units
export function formatFeet(feet: number, units: Units, locale = 'en-US'): string {
  return `${Math.round(distanceFromFeet(feet, units)).toLocaleString(locale)} ${DISTANCE_UNIT[units]}`;
}

// 30.5 m/s -> "68.2 mph" (or "109.8 kph")
export function formatSpeed(metersPerSecond: number, units: Units, digits = 1): string {
  return `${speedFromMetersPerSecond(metersPerSecond, units).toFixed(digits)} ${SPEED_UNIT[units]}`;
}

// 25 °C -> "77.0°F" (or "25.0°C")
export function formatTemperature(celsius: number, units: Units): string {
  return `${temperatureFromCelsius(celsius, units).toFixed(1)}${TEMPERATURE_UNIT[units]}`;
}
