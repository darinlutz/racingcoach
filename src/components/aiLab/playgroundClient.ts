'use client';

import type { PlaygroundMetrics } from '@/lib/aiLab/playground';

// The browser's side of POST /api/admin/ai-lab/playground: reads the NDJSON it answers, handing each token to
// onToken as it arrives, and resolves with the text and measurements, or the error code the route sent.

export type RunTarget = { provider: 'Local' | 'Cloud'; model: string; serverId?: string | null };
export type RunResult = { text: string; thinking: string; metrics: PlaygroundMetrics | null; error: string | null; detail: string | null };

export async function runModel(
  input: { target: RunTarget; system: string; prompt: string; params: Record<string, number | undefined> },
  handlers: { onToken?: (text: string) => void; onThinking?: (text: string) => void; signal?: AbortSignal } = {}
): Promise<RunResult> {
  const result: RunResult = { text: '', thinking: '', metrics: null, error: null, detail: null };
  let response: Response;
  try {
    response = await fetch('/api/admin/ai-lab/playground', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
      signal: handlers.signal,
    });
  } catch (error) {
    return { ...result, error: handlers.signal?.aborted ? 'aborted' : 'unreachable', detail: error instanceof Error ? error.message : null };
  }
  if (!response.ok || !response.body) {
    const body = await response.json().catch(() => ({}));
    return { ...result, error: String(body.error ?? `http${response.status}`), detail: body.detail ?? null };
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const raw = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!raw) continue;
        const event = JSON.parse(raw) as { type: string; text?: string; metrics?: PlaygroundMetrics; error?: string; detail?: string | null };
        if (event.type === 'token' && event.text) {
          result.text += event.text;
          handlers.onToken?.(event.text);
        } else if (event.type === 'thinking' && event.text) {
          result.thinking += event.text;
          handlers.onThinking?.(event.text);
        } else if (event.type === 'done') {
          result.metrics = event.metrics ?? null;
        } else if (event.type === 'error') {
          result.error = event.error ?? 'error';
          result.detail = event.detail ?? null;
        }
      }
    }
  } catch (error) {
    result.error = handlers.signal?.aborted ? 'aborted' : 'interrupted';
    result.detail = error instanceof Error ? error.message : null;
  }
  return result;
}
