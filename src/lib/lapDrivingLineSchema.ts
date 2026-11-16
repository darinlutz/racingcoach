// The shape of Lap Compare's driving line comparison as it's posted to /api/lap-summary (measured in the browser by
// measureDrivingLine, src/lib/lapDrivingLine.ts). Only the server imports this file, so zod stays out of the browser.

import { z } from 'zod';
import { LINE_POINTS } from '@/lib/lapDrivingLine';

export const lapDrivingLineSchema = z.object({
  area: z.string().max(100),
  // Compare minus Target through the area; negative means the Compare lap was faster
  secondsDiff: z.number(),
  // Meters the Compare lap was left (+) or right (-) of the Target lap's line, every 10% through the area
  offsetsM: z.array(z.number()).length(LINE_POINTS),
  // The largest difference anywhere in the area, and how far through the area (%) it was
  maxOffsetM: z.number(),
  maxOffsetAtPct: z.number(),
  // Which way the corner turns, from the Target lap's steering at its slowest point; null for a straight or chicane
  turn: z.enum(['left', 'right']).nullable(),
});
export const lapDrivingLinesSchema = z.array(lapDrivingLineSchema).max(50);
export type LapDrivingLine = z.infer<typeof lapDrivingLineSchema>;
