// Writes a user's tracks in the Track_Area_Information.txt format: a JavaScript object literal keyed by
// lowercase track key, tracks sorted by TrackFileName, areas in order around the lap. Targets that are not
// set are written as 0, the file's placeholder for "no target".

import type { UserTrack } from '@/lib/tracks';

const HEADER = `// ============================================================
// TRACK CONFIGURATION
// ============================================================
//
// STATIC DATA ONLY
//
// Add tracks and areas here.
// There is no limit to the number of areas per track.
//
// Track keys are stored in lowercase because the main
// JavaScript file performs a case-insensitive lookup.
//
// Tracks are listed alphabetically by TrackFileName.
//
// Areas are stored in chronological order around the track,
// based on the LapDistPct start position.
//
// Additional track-level and area-level properties can be
// added whenever needed.
// ============================================================


const TrackConfig = {

`;

const RULE = '// ========================================================';

const str = (value: string | null) => JSON.stringify(value ?? '');
const int = (value: number | null) => String(value ?? 0);
// Lap fractions are written with two decimals (0.90) unless that would lose precision
const pct = (value: number) => (Number(value.toFixed(2)) === value ? value.toFixed(2) : String(value));

function areaBlock(area: UserTrack['areas'][number]) {
  return [
    '            {',
    `                name: ${str(area.name)},`,
    `                start: ${pct(area.startPoint)},`,
    `                end: ${pct(area.endPoint)},`,
    `                Notes: ${str(area.notes)},`,
    `                BrakepointTarget: ${int(area.brakePointFeet)},`,
    `                MaxBrakeTarget: ${int(area.maxBrakePct)},`,
    `                ThrottlePickupTarget: ${int(area.throttlePointFeet)}`,
    '            }',
  ].join('\n');
}

function trackBlock(track: UserTrack) {
  const areas = [...track.areas].sort((a, b) => a.position - b.position);
  return [
    `    ${RULE}`,
    `    // ${track.name.toUpperCase()}`,
    `    ${RULE}`,
    '',
    `    ${JSON.stringify(track.key.toLowerCase())}: {`,
    '',
    `        TrackFileName: ${str(track.name)},`,
    `        TrackLengthInFeet: ${int(track.lengthFeet)},`,
    `        Notes: ${str(track.notes)},`,
    '',
    '        areas: [',
    areas.length > 0 ? areas.map(areaBlock).join(',\n') : '            // TODO: add areas',
    '        ]',
    '    }',
  ].join('\n');
}

export function trackFileText(tracks: UserTrack[]): string {
  const sorted = [...tracks].sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  return `${HEADER}${sorted.map(trackBlock).join(',\n\n\n')}\n\n};\n`;
}
