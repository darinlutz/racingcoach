// Lap Compare's driving line comparison of the Target and Compare laps through one focus area: measured in the
// browser from both laps' track positions (the CSVs are too big to send) and posted with the lap comparison
// for the Racing Coach's analyze_driving_line tool (src/lib/lapSummary.ts). DrivingLineDiffTrace draws the
// same measurement.

import { lineDetail, lineOffsets, steeringDetail } from '@/lib/areaInputs';
import type { AreaTrace } from '@/lib/lapData';
import type { LapDrivingLine } from '@/lib/lapDrivingLineSchema';

// The Compare lap's distance from the Target line is sent every 10% through the area
export const LINE_POINTS = 11;
// The Target lap's wheel angle at its slowest point under this (degrees) is a straight or a chicane
const MIN_APEX_DEGREES = 5;

// What's posted is checked by lapDrivingLinesSchema (src/lib/lapDrivingLineSchema.ts), kept in its own file so the
// browser, which only measures, doesn't load zod: zod tests whether it may compile code when its first schema is made,
// which every visitor's browser reported as a Content-Security-Policy violation
export type { LapDrivingLine };

// null when either lap has no track positions in the area
export function measureDrivingLine(area: string, secondsDiff: number, base: AreaTrace, compare: AreaTrace): LapDrivingLine | null {
  const offsetAt = lineOffsets(compare, base);
  const detail = lineDetail(compare, base);
  if (!offsetAt || !detail) return null;
  const apexDeg = steeringDetail(base)?.apexDeg ?? 0;
  return {
    area,
    secondsDiff,
    offsetsM: Array.from({ length: LINE_POINTS }, (_, i) => Number(offsetAt(i / (LINE_POINTS - 1)).toFixed(1))),
    maxOffsetM: detail.maxOffsetM,
    maxOffsetAtPct: detail.maxOffsetAtPct,
    turn: Math.abs(apexDeg) < MIN_APEX_DEGREES ? null : apexDeg > 0 ? 'left' : 'right',
  };
}
