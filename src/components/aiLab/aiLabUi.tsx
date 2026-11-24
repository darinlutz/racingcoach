'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { StatusColor } from '@/lib/aiLab/rules';

// What the AI Lab tabs share: the styles the Local AI sections use, the status dot, byte and time formatting, and a
// small fetch helper that turns an error code from the routes into the dictionary's sentence.

export const inputClass =
  'w-full px-3 py-2 bg-card border border-border rounded-lg text-foreground text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors';
export const labelClass = 'block text-xs font-medium text-muted-foreground mb-1';
export const buttonClass =
  'px-3 py-1.5 rounded-lg text-sm font-semibold border border-border text-foreground hover:border-primary transition-colors disabled:opacity-50';
export const primaryClass = 'px-4 py-2 rounded-lg text-sm font-semibold text-white bg-primary hover:bg-primary-strong transition-colors disabled:opacity-50';
export const dangerClass = 'px-3 py-1.5 rounded-lg text-sm font-semibold border border-red-500/60 text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-50';

export function Panel({ title, intro, children, id }: { title: string; intro?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section id={id} className="bg-secondary rounded-xl border border-border p-4 sm:p-6 space-y-4">
      <div className="space-y-1">
        <h2 className="text-xl font-bold text-foreground">{title}</h2>
        {intro && <p className="text-sm text-muted-foreground">{intro}</p>}
      </div>
      {children}
    </section>
  );
}

const DOT: Record<StatusColor, string> = {
  green: 'bg-green-500',
  yellow: 'bg-yellow-400',
  red: 'bg-red-500',
  gray: 'bg-gray-400',
};

export function StatusDot({ color, label }: { color: StatusColor; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-foreground">
      <span className={`inline-block w-2.5 h-2.5 rounded-full ${DOT[color]}`} aria-hidden />
      {label}
    </span>
  );
}

export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warn' | 'error' }) {
  const styles = {
    info: 'border-border text-muted-foreground',
    warn: 'border-yellow-500/50 text-yellow-500',
    error: 'border-red-500/50 text-red-500',
  }[tone];
  return <p className={`text-sm rounded-lg border px-3 py-2 ${styles}`}>{children}</p>;
}

export function formatBytes(bytes: number | null | undefined, number: (n: number, o?: Intl.NumberFormatOptions) => string): string | null {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return null;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${number(value, { maximumFractionDigits: value < 10 ? 1 : 0 })} ${units[unit]}`;
}

export function formatDuration(seconds: number): string {
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m ${Math.floor(seconds % 60)}s`;
}

export const localTime = (iso: string | number | null | undefined) => (iso ? new Date(typeof iso === 'number' && iso < 1e12 ? iso * 1000 : iso).toLocaleString() : null);

export class LabApiError extends Error {
  constructor(public code: string, public detail: string | null, public status: number) {
    super(code);
  }
}

export async function labApi<T = Record<string, unknown>>(url: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const response = await fetch(url, {
    method: init?.method ?? (init?.body === undefined ? 'GET' : 'POST'),
    headers: init?.body === undefined ? undefined : { 'content-type': 'application/json' },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    cache: 'no-store',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new LabApiError(String(data.error ?? `http${response.status}`), typeof data.detail === 'string' ? data.detail : null, response.status);
  return data as T;
}

// The dictionary's sentence for an error code, else the code and detail
export function errorText(error: unknown, errors: Record<string, string>, fallback: string): string {
  if (error instanceof LabApiError) {
    const known = errors[error.code];
    if (known) return known.replace('{detail}', error.detail ?? '');
    return fallback.replace('{error}', [error.code, error.detail].filter(Boolean).join(': '));
  }
  return fallback.replace('{error}', error instanceof Error ? error.message : String(error));
}

// The Overview's status, shared by the tabs: polled every 15 s while the page is visible, never while hidden, so a
// tab left open on a sleeping Mac doesn't keep asking
export type LabOverview = {
  lab:
    | { reachable: true; checkedAt: number; latencyMs: number; serverId: string; data: LabGatewayStatus }
    | { reachable: false; checkedAt: number; serverId: string | null; reason: string; detail: string | null };
  history: { lastSuccessAt: number | null; lastError: { at: number; reason: string; detail: string | null } | null };
  production: {
    configured: { sharedSecret: boolean; cloudflareAccess: boolean };
    mode: string;
    servers: { id: string; label: string; gatewayUrl: string; enabled: boolean; maxConcurrency: number; online: boolean; availability: string; receivedAt: string | null; lastHeartbeatAt: string | null }[];
  };
  inference24h: { localRequests: number; cloudRequests: number; avgLatencyMs: number | null; requests: number };
  settings: { openWebuiUrl: string | null; dailyCloudBudgetUsd: number; defaultModel: string | null; modelParams: Record<string, Record<string, number>> };
  spentTodayUsd: number;
  audit: { id: number; at: string; user: string | null; action: string; target: string | null; outcome: string }[];
};

export type LabGatewayStatus = {
  agentVersion: string;
  uptimeSeconds: number;
  lab: { manage: boolean; active: number; maxConcurrency: number; maxContext: number; maxOutput: number };
  production: { models: string[]; active: number; maxConcurrency: number };
  ollama: { ok: boolean; version: string | null; error: string | null };
  models: { name: string; family: string | null; parameterSize: string | null; quantization: string | null; sizeBytes: number | null; modifiedAt: string | null }[];
  loaded: { name: string; sizeBytes: number | null; vramBytes: number | null; contextLength: number | null; expiresAt: string | null }[];
  openWebui: { configured: boolean; ok: boolean | null; version: string | null; apiKey: boolean; error: string | null };
  pulls: { name: string; status: string; completed: number | null; total: number | null; startedAt: number; finishedAt: number | null; error: string | null }[];
};

export function useLabOverview() {
  const [data, setData] = useState<LabOverview | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (fresh = false) => {
    setBusy(true);
    try {
      setData(await labApi<LabOverview>(`/api/admin/ai-lab/status${fresh ? '?fresh=1' : ''}`));
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the first status, then polling
    void load();
    const start = () => {
      if (!timer.current) timer.current = setInterval(() => document.visibilityState === 'visible' && void load(), 15_000);
    };
    const onVisible = () => document.visibilityState === 'visible' && void load();
    start();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  return { data, error, busy, reload: load };
}
