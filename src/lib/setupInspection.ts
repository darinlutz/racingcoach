// Technical inspection for the Setups page's Inspection tab. Pure (scripts/setups.test.mjs).
//
// iRacing's own inspection result is session info's DriverInfo.DriverSetupPassedTech, captured by the collector with
// the setup: 1 is passed (seen in real captures); 0 is read as failed (iRacing's meaning, not yet seen in a capture
// here); anything else, or nothing, is unknown. A setup no capture has seen loaded is "not yet checked". iRacing gives
// no reason for a failure, so none is ever shown.
//
// RacingCoach's own checks (PRELIMINARY_RULES) are a preliminary validation, never an inspection pass: they can only
// say what the setup's own values show. A car's legal limits are only added here from verified data (a person checked
// them against the car in iRacing), with the car and configuration they apply to; there are none yet, so the
// preliminary validation only reports what it could and couldn't check.
import type { SetupParameter } from './setupYaml.ts';

export type InspectionResult = 'passed' | 'failed' | 'unknown' | 'notChecked';

export function inspectionResult(passedTech: number | null | undefined): InspectionResult {
  if (passedTech === 1) return 'passed';
  if (passedTech === 0) return 'failed';
  return 'unknown';
}

export type RuleFinding = { rule: string; severity: 'error' | 'warning' | 'info'; path: string | null; message: string };

export type PreliminaryRule = {
  id: string;
  // The cars (iRacing car keys) it applies to; empty for every car
  cars: string[];
  // Where it came from: who checked it and how, for the page
  source: string;
  check: (parameters: SetupParameter[]) => RuleFinding[];
};

// Verified rules only. Each one names its cars and its source; an unverified limit must never go here
export const PRELIMINARY_RULES: PreliminaryRule[] = [];

export type PreliminaryValidation = {
  // 'preliminary' always: this is not iRacing's inspection
  label: 'preliminary';
  checkedRules: number;
  findings: RuleFinding[];
  // No verified rules for this car, so nothing about legality could be checked
  noRulesForCar: boolean;
  // How many of the setup's values are known (a .sto that iRacing hasn't loaded yet has none)
  knownValues: number;
};

export function preliminaryValidation(carKey: string | null, parameters: SetupParameter[], rules = PRELIMINARY_RULES): PreliminaryValidation {
  const applicable = rules.filter((rule) => rule.cars.length === 0 || (carKey && rule.cars.includes(carKey.toLowerCase())));
  const findings = parameters.length ? applicable.flatMap((rule) => rule.check(parameters)) : [];
  return {
    label: 'preliminary',
    checkedRules: parameters.length ? applicable.length : 0,
    findings,
    noRulesForCar: applicable.length === 0,
    knownValues: parameters.length,
  };
}

// iRacing's setup load types (DriverSetupLoadTypeName) as captured; "iracing" is one of iRacing's own setups, "user"
// the driver's. Whether the SESSION is a fixed setup session is WeekendInfo.WeekendOptions.IsFixedSetup, not the setup's
// name: iRacing's own GT3 setups include one named "fixed.sto" that loads in open sessions too
export function fixedSetupSession(input: { fixedSession?: boolean | null; loadType?: string | null; name?: string | null }): {
  fixed: boolean;
  known: boolean;
} {
  if (input.fixedSession != null) return { fixed: input.fixedSession, known: true };
  if (/^fixed$/i.test(input.loadType?.trim() ?? '')) return { fixed: true, known: true };
  // Only the name says "fixed": it may or may not be a fixed setup session
  return { fixed: false, known: !/fixed/i.test(input.name ?? '') && !!input.loadType };
}
