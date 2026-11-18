// Setup changes: the Setup Engineer's proposals checked against the setup they're for, and approved changes applied to
// make a new revision. Pure (scripts/setups.test.mjs).
//
// A proposal is only kept when it names a parameter this setup really has (by path), one the garage sets (not a
// reading), with a number in that parameter's own unit; in a fixed setup session only in-car adjustments are kept.
// Nothing here knows a car's legal ranges or click steps (iRacing doesn't share them), so a proposal always carries a
// warning that the range isn't checked, and a large step another warning. Nothing is applied unless the driver
// approves it, and an applied change makes a new revision: the original is never changed.
import { formatLike, type SetupParameter } from './setupYaml.ts';

export type Confidence = 'low' | 'medium' | 'high';

export type ProposalWarning = 'rangeUnknown' | 'largeStep' | 'readingNotSet' | 'fixedSession';

export type SetupProposal = {
  path: string;
  current: string;
  proposed: string;
  proposedValue: number;
  unit: string | null;
  reason: string;
  expectedEffect: string;
  confidence: Confidence;
  warnings: ProposalWarning[];
};

export type RejectedProposal = { path: string; why: 'unknownParameter' | 'reading' | 'notNumeric' | 'fixedSession' | 'noChange' | 'duplicate' };

// What the model answers for each change (setupEngineer.ts's schema)
export type RawProposal = {
  path: string;
  proposedValue: number;
  reason: string;
  expectedEffect: string;
  confidence: string;
};

export const MAX_PROPOSALS = 6;
// A step bigger than this share of the current value gets the largeStep warning
const LARGE_STEP = 0.2;

export function checkProposals(
  raw: RawProposal[],
  parameters: SetupParameter[],
  options: { fixedSession: boolean }
): { kept: SetupProposal[]; rejected: RejectedProposal[] } {
  const byPath = new Map(parameters.map((p) => [p.path, p]));
  const kept: SetupProposal[] = [];
  const rejected: RejectedProposal[] = [];
  const seen = new Set<string>();
  for (const proposal of raw) {
    const path = String(proposal.path ?? '').trim();
    const parameter = byPath.get(path);
    if (!parameter) {
      rejected.push({ path, why: 'unknownParameter' });
      continue;
    }
    if (seen.has(path)) {
      rejected.push({ path, why: 'duplicate' });
      continue;
    }
    if (parameter.kind === 'reading') {
      rejected.push({ path, why: 'reading' });
      continue;
    }
    if (parameter.value == null || !Number.isFinite(proposal.proposedValue)) {
      rejected.push({ path, why: 'notNumeric' });
      continue;
    }
    if (options.fixedSession && !parameter.inCar) {
      rejected.push({ path, why: 'fixedSession' });
      continue;
    }
    // Rounded to the parameter's own precision, as that's all the garage can be set to
    const value = Number(proposal.proposedValue.toFixed(parameter.decimals));
    if (value === parameter.value) {
      rejected.push({ path, why: 'noChange' });
      continue;
    }
    seen.add(path);
    const warnings: ProposalWarning[] = ['rangeUnknown'];
    const step = Math.abs(value - parameter.value);
    if (parameter.value !== 0 ? step / Math.abs(parameter.value) > LARGE_STEP : step > 1) warnings.push('largeStep');
    const confidence = (['low', 'medium', 'high'] as const).find((c) => c === String(proposal.confidence).toLowerCase()) ?? 'low';
    kept.push({
      path,
      current: parameter.raw,
      proposed: formatLike(parameter, value),
      proposedValue: value,
      unit: parameter.unit,
      reason: String(proposal.reason ?? '').slice(0, 400),
      expectedEffect: String(proposal.expectedEffect ?? '').slice(0, 300),
      confidence,
      warnings,
    });
    if (kept.length >= MAX_PROPOSALS) break;
  }
  return { kept, rejected };
}

export type AppliedChange = { path: string; from: string; to: string };

// A new list of parameters with the changes applied (value, raw text), and what changed. A change to a path the setup
// doesn't have, a reading or a value that isn't a number is refused (the caller answers 400)
export function applyChanges(
  parameters: SetupParameter[],
  changes: { path: string; value: number }[]
): { parameters: SetupParameter[]; changed: AppliedChange[] } | { error: 'unknownParameter' | 'reading' | 'notNumeric'; path: string } {
  const byPath = new Map(parameters.map((p) => [p.path, p]));
  const updates = new Map<string, number>();
  for (const change of changes) {
    const parameter = byPath.get(change.path);
    if (!parameter) return { error: 'unknownParameter', path: change.path };
    if (parameter.kind === 'reading') return { error: 'reading', path: change.path };
    if (parameter.value == null || !Number.isFinite(change.value)) return { error: 'notNumeric', path: change.path };
    updates.set(change.path, Number(change.value.toFixed(parameter.decimals)));
  }
  const changed: AppliedChange[] = [];
  const next = parameters.map((p) => {
    const value = updates.get(p.path);
    if (value === undefined || value === p.value) return p;
    const raw = formatLike(p, value);
    changed.push({ path: p.path, from: p.raw, to: raw });
    return { ...p, raw, value, values: [value] };
  });
  return { parameters: next, changed };
}

// The change sheet: what to set in iRacing's garage by hand, as RacingCoach can't write a .sto iRacing accepts
// (stoFile.ts). Plain text, one line per change, in the garage's own tab, box and key names
export function changeSheet(title: string, changes: AppliedChange[], labels: { from: string; to: string }): string {
  const lines = [title, ''];
  for (const change of changes) {
    const [section, ...rest] = change.path.split('.');
    lines.push(`${section} › ${rest.join(' › ')}: ${labels.from} ${change.from}  ${labels.to} ${change.to}`);
  }
  return lines.join('\n') + '\n';
}
