import type { Diagnostic, Format } from './broadcastDirector';
import { elevenLabsCharacters } from './elevenLabs';

// The Race Broadcast's performance and cost figures since the server started, for Admins
// (GET /api/admin/broadcast-metrics): how many commentary requests came in and how many were answered without an AI
// call, why events were suppressed, lines dropped by the factual check or for going stale, how long the AI and the
// speech took, from event to audio ready, ElevenLabs characters, and the latest decisions with each event's verdict.
// Tokens and cost per call are in the Admin page's AI usage report ("AiUsage", feature raceAnnouncer). Kept in this
// server's memory, like the live positions.

const SAMPLES = 200;
const RECENT = 50;

type Recent = {
  at: number;
  viewerId: number;
  driverId: number;
  announced: { seq: number; type: string; priority: number; intensity: number; format: Format } | null;
  lines: { speaker: string; text: string; intensity: number }[];
  diagnostics: Diagnostic[];
  note: string | null;
};

type Store = {
  since: number;
  requests: number;
  noCommentary: number;
  announced: number;
  suppressed: Record<string, number>;
  droppedLines: Record<string, number>;
  staleAfterGeneration: number;
  llmFailures: number;
  speechFailures: number;
  linesSpoken: number;
  userRelated: number;
  intensity: Record<number, number>;
  formats: Record<string, number>;
  llmMs: number[];
  speechMs: number[];
  eventToAudioMs: number[];
  recent: Recent[];
};

const store = globalThis as unknown as { broadcastMetrics?: Store };
const m = (store.broadcastMetrics ??= {
  since: Date.now(),
  requests: 0,
  noCommentary: 0,
  announced: 0,
  suppressed: {},
  droppedLines: {},
  staleAfterGeneration: 0,
  llmFailures: 0,
  speechFailures: 0,
  linesSpoken: 0,
  userRelated: 0,
  intensity: {},
  formats: {},
  llmMs: [],
  speechMs: [],
  eventToAudioMs: [],
  recent: [],
});

const push = (list: number[], value: number) => {
  list.push(value);
  if (list.length > SAMPLES) list.shift();
};
const bump = (counts: Record<string | number, number>, key: string | number) => {
  counts[key] = (counts[key] ?? 0) + 1;
};

export function recordDecision(viewerId: number, driverId: number, diagnostics: Diagnostic[], announced: Recent['announced'], userRelated: boolean) {
  m.requests++;
  for (const d of diagnostics) if (d.verdict === 'suppressed') bump(m.suppressed, d.reason);
  if (!announced) {
    m.noCommentary++;
    if (diagnostics.length > 0) addRecent({ at: Date.now(), viewerId, driverId, announced, lines: [], diagnostics, note: null });
    return;
  }
  m.announced++;
  if (userRelated) m.userRelated++;
  bump(m.intensity, announced.intensity);
  bump(m.formats, announced.format);
}

export function recordDroppedLine(reason: string) {
  bump(m.droppedLines, reason);
}

export function recordFailure(stage: 'llm' | 'speech') {
  if (stage === 'llm') m.llmFailures++;
  else m.speechFailures++;
}

export function recordStale() {
  m.staleAfterGeneration++;
}

export function recordSpoken(entry: Omit<Recent, 'at' | 'note'> & { llmMs: number; speechMs: number; eventAgeMs: number }) {
  push(m.llmMs, entry.llmMs);
  push(m.speechMs, entry.speechMs);
  push(m.eventToAudioMs, entry.eventAgeMs);
  m.linesSpoken += entry.lines.length;
  addRecent({ at: Date.now(), viewerId: entry.viewerId, driverId: entry.driverId, announced: entry.announced, lines: entry.lines, diagnostics: entry.diagnostics, note: null });
}

export function recordNote(viewerId: number, driverId: number, note: string, diagnostics: Diagnostic[] = []) {
  addRecent({ at: Date.now(), viewerId, driverId, announced: null, lines: [], diagnostics, note });
}

function addRecent(entry: Recent) {
  m.recent.push(entry);
  if (m.recent.length > RECENT) m.recent.shift();
}

function summary(values: number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: values.length,
    avgMs: Math.round(values.reduce((a, b) => a + b, 0) / values.length),
    p95Ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))],
  };
}

export function broadcastMetrics() {
  return {
    since: new Date(m.since).toISOString(),
    requests: m.requests,
    answeredWithoutAi: m.noCommentary,
    announced: m.announced,
    userRelatedShare: m.announced > 0 ? Math.round((m.userRelated / m.announced) * 100) / 100 : null,
    suppressed: m.suppressed,
    droppedLines: m.droppedLines,
    staleAfterGeneration: m.staleAfterGeneration,
    discardedShare: m.announced > 0 ? Math.round((m.staleAfterGeneration / m.announced) * 100) / 100 : null,
    llmFailures: m.llmFailures,
    speechFailures: m.speechFailures,
    linesSpoken: m.linesSpoken,
    intensity: m.intensity,
    formats: m.formats,
    latency: { llm: summary(m.llmMs), speech: summary(m.speechMs), eventToAudioReady: summary(m.eventToAudioMs) },
    elevenLabsCharacters: elevenLabsCharacters(),
    recent: [...m.recent].reverse(),
  };
}
