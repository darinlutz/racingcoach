// The Setups page's requests from the browser (src/components/Setup*.tsx). Types only from the server modules, so
// nothing of theirs reaches the browser.
import { reportRateLimit } from './rateLimitClient';
import type { CompareRow, SetupComparison } from './setupCompare';
import type {
  HistoryEntry,
  InspectionRecord,
  LinkedLaps,
  ProposalSummary,
  RevisionDetail,
  RevisionSummary,
  SetupDetail,
  SetupOverview,
  SetupSummary,
} from './setups';
import type { PreliminaryValidation } from './setupInspection';
import type { SetupParameter } from './setupYaml';

export type { CompareRow, HistoryEntry, InspectionRecord, ProposalSummary, RevisionDetail, RevisionSummary, SetupDetail, SetupParameter, SetupSummary };

export type CollectorStatus = { live: false } | { live: true; car: string; track: string; at: string; setup?: unknown };
export type SetupsList = { setups: SetupSummary[]; overview: SetupOverview; collector: CollectorStatus };
export type SetupDetailResponse = { setup: SetupDetail; proposals: ProposalSummary[]; validation: PreliminaryValidation };
export type LapsSummary = Omit<LinkedLaps, 'clientLapIds'> | null;
export type CompareResponse = {
  baseline: Omit<RevisionDetail, 'parameters'> & { valueCount: number };
  comparison: Omit<RevisionDetail, 'parameters'> & { valueCount: number };
  result: SetupComparison;
  laps: { baseline: LapsSummary; comparison: LapsSummary };
};

export type Result<T> = { ok: true; data: T } | { ok: false; status: number; error: string; code?: string };

export async function setupsRequest<T>(url: string, init?: RequestInit): Promise<Result<T>> {
  try {
    const res = await fetch(url, init);
    const data = await res.json().catch(() => null);
    if (res.ok) return { ok: true, data: data as T };
    reportRateLimit(res, data);
    return { ok: false, status: res.status, error: typeof data?.error === 'string' ? data.error : '', code: data?.code };
  } catch {
    return { ok: false, status: 0, error: '' };
  }
}

export const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

// A lap time as m:ss.sss
export function lapTime(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}
