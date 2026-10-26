// Saves a lap CSV as the signed-in user's Target Lap (PUT /api/account/target-lap), from Debrief Coach's
// Target Lap card and Set Target buttons. Throws with the server's message when it isn't saved.

export type SavedTargetLap = { fileName: string; setAt: string };

export async function uploadTargetLap(file: File, fallbackError: string): Promise<SavedTargetLap> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch('/api/account/target-lap', { method: 'PUT', body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || fallbackError);
  return data.targetLap;
}

// "Garage 61 - Driver - Car - Track - 01.18.683 - ID.csv" or "RacingCoach - ..." -> its parts; null for any
// other name, which is then shown as it is
const LAP_FILE_NAME = /^(.+?) - (.+?) - (.+?) - (.+) - (\d+\.\d{2}\.\d{3}) - ([A-Za-z0-9]+)\.csv$/i;

export function targetLapParts(fileName: string) {
  const match = fileName.match(LAP_FILE_NAME);
  if (!match) return null;
  const [, , driver, car, track, lapTime] = match;
  return { driver, car, track, lapTime };
}
