// Lap Compare's driving line comparison of the Base and Compare laps through one focus area: measured in the
// browser from both laps' track positions (the CSVs are too big to send) and posted with the lap comparison
// for the Racing Coach's analyze_driving_line tool (src/lib/lapSummary.ts). DrivingLineDiffTrace draws the
// same measurement.

import { z } from 'zod';
import { lineDetail, lineOffsets, steeringDetail } from '@/lib/areaInputs';
import type { AreaTrace } from '@/lib/lapData';

// The Compare lap's distance from the Base line is sent every 10% through the area
const LINE_POINTS = 11;
// The Base lap's wheel angle at its slowest point under this (degrees) is a straight or a chicane
const MIN_APEX_DEGREES = 5;

export const lapDrivingLineSchema = z.object({
  area: z.string().max(100),
  // Compare minus Base through the area; negative means the Compare lap was faster
  secondsDiff: z.number(),
  // Meters the Compare lap was left (+) or right (-) of the Base lap's line, every 10% through the area
  offsetsM: z.array(z.number()).length(LINE_POINTS),
  // The largest difference anywhere in the area, and how far through the area (%) it was
  maxOffsetM: z.number(),
  maxOffsetAtPct: z.number(),
  // Which way the corner turns, from the Base lap's steering at its slowest point; null for a straight or chicane
  turn: z.enum(['left', 'right']).nullable(),
});
export const lapDrivingLinesSchema = z.array(lapDrivingLineSchema).max(50);
export type LapDrivingLine = z.infer<typeof lapDrivingLineSchema>;

// null when either lap has no track positions in the area
export function measureDrivingLine(area: string, secondsDiff: number, base: AreaTrace, compare: AreaTrace): LapDrivingLine | null {
  const offsetAt = lineOffsets(compare, base);
  const detail = lineDetail(compare, base);
  if (!offsetAt || !detail) return null;
  const { apexDeg } = steeringDetail(base);
  return {
    area,
    secondsDiff,
    offsetsM: Array.from({ length: LINE_POINTS }, (_, i) => Number(offsetAt(i / (LINE_POINTS - 1)).toFixed(1))),
    maxOffsetM: detail.maxOffsetM,
    maxOffsetAtPct: detail.maxOffsetAtPct,
    turn: Math.abs(apexDeg) < MIN_APEX_DEGREES ? null : apexDeg > 0 ? 'left' : 'right',
  };
}
