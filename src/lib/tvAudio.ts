// The Race Announcers' commentary playback, on TV Broadcast Mode (src/components/useTvCommentary.ts) and the Live
// Racing page (src/components/LiveRacing.tsx): the lines wait in a queue and play one at a time, in order, so two
// never overlap. A line that waited too long, or past the moment it was about (expiresAt, from the Commentary
// Director), is dropped, as the race has moved on; a more important commentary (replaceQueued) drops the less
// important lines still waiting, never the one playing; and the same words aren't played twice in a row (a repeated
// answer after a reconnect). No imports, so Node runs it directly (npm run test:tv).

export type QueuedLine = {
  speaker: 'lead' | 'color';
  text: string;
  audio: string;
  queuedAt: number;
  // 0 critical to 4 background (the Commentary Director's priority); lines without one count as 2
  priority?: number;
  // When the line is no longer worth playing, on this clock
  expiresAt?: number;
  // 0-1, the listener's master and announcer volume
  volume?: number;
};

// A line waiting longer than this isn't played
export const MAX_LINE_WAIT_MS = 20_000;
const RECENT_TEXTS = 8;
const DEFAULT_PRIORITY = 2;

export class CommentaryQueue {
  private lines: QueuedLine[] = [];
  private recent: string[] = [];
  // Lines dropped unplayed (expired or replaced), for the diagnostics
  dropped = 0;

  // replaceQueued: these lines are important enough to drop waiting lines of lower priority (a higher number)
  push(lines: Omit<QueuedLine, 'queuedAt'>[], now: number, replaceQueued = false): void {
    if (replaceQueued && lines.length > 0) {
      const priority = Math.min(...lines.map((l) => l.priority ?? DEFAULT_PRIORITY));
      const kept = this.lines.filter((l) => (l.priority ?? DEFAULT_PRIORITY) <= priority);
      this.dropped += this.lines.length - kept.length;
      this.lines = kept;
    }
    for (const line of lines) {
      const text = line.text.trim();
      if (!text || this.recent.includes(text) || this.lines.some((l) => l.text === text)) continue;
      this.lines.push({ ...line, text, queuedAt: now });
    }
  }

  // The next line to play, or null; lines past MAX_LINE_WAIT_MS or their expiresAt are dropped on the way
  next(now: number): QueuedLine | null {
    while (this.lines.length > 0) {
      const line = this.lines.shift()!;
      if (now - line.queuedAt > MAX_LINE_WAIT_MS || (line.expiresAt != null && now > line.expiresAt)) {
        this.dropped++;
        continue;
      }
      this.recent = [...this.recent, line.text].slice(-RECENT_TEXTS);
      return line;
    }
    return null;
  }

  get size(): number {
    return this.lines.length;
  }

  clear(): void {
    this.lines = [];
  }
}

// A short sine tone as a WAV file (16-bit mono), for the Test sound button and to wake the TV's audio on Start
// Broadcast; volume 0 makes silence
export function toneWav(frequency: number, ms: number, volume = 0.3, sampleRate = 22_050): Uint8Array {
  const samples = Math.round((sampleRate * ms) / 1000);
  const bytes = new Uint8Array(44 + samples * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string) => [...text].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + samples * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, samples * 2, true);
  const fade = Math.min(samples / 2, sampleRate * 0.01);
  for (let i = 0; i < samples; i++) {
    const envelope = Math.min(1, i / fade, (samples - i) / fade);
    view.setInt16(44 + i * 2, Math.round(Math.sin((2 * Math.PI * frequency * i) / sampleRate) * volume * envelope * 32767), true);
  }
  return bytes;
}
