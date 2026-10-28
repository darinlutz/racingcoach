// Formatting shared by the Live Racing page's components

// 109.479 -> "1:49.479"; iRacing gives 0 or -1 when there's no time
export function formatLapTime(seconds: number | null | undefined): string {
  if (seconds == null || seconds <= 0) return '—';
  const ms = Math.round(seconds * 1000);
  const minutes = Math.floor(ms / 60_000);
  const rest = (ms % 60_000) / 1000;
  return `${minutes}:${rest.toFixed(3).padStart(6, '0')}`;
}

// A gap in seconds: "+1.234", or "+1:02.345" from a minute
export function formatGap(seconds: number): string {
  if (seconds < 60) return `+${seconds.toFixed(3)}`;
  return `+${formatLapTime(seconds)}`;
}
