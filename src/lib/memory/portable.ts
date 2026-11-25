// Pure parts of import, export, evaluation and fine-tuning datasets (docs/AI_MEMORY_OPERATIONS.md and
// docs/AI_MEMORY_EVALUATION.md): parsing, serializing, retrieval metrics and dataset splits. No I/O.

import { createHash } from 'node:crypto';
import { detectSensitive, LIMITS, normalizeContent } from './rules';

// ---- Import parsing ----

export const IMPORT_FORMATS = ['json', 'jsonl', 'csv', 'openWebui'] as const;
export type ImportFormat = (typeof IMPORT_FORMATS)[number];
export const MAX_IMPORT_ROWS = 2000;

export type ImportRow = {
  line: number;
  title: string | null;
  content: string;
  category: string | null;
  namespace: string | null;
  importance: number | null;
  confidence: number | null;
  expiresAt: string | null;
  pinned: boolean;
  locked: boolean;
  externalId: string | null;
  createdAt: string | null;
};

export type ParsedImport = { rows: ImportRow[]; errors: { line: number; error: string }[] };

// RFC 4180: quoted fields, doubled quotes, newlines inside quotes
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

const truthy = (v: unknown) => v === true || (typeof v === 'string' && /^(true|yes|1)$/i.test(v.trim()));
const numOrNull = (v: unknown) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const dateOrNull = (v: unknown) => {
  if (v === null || v === undefined || v === '') return null;
  // Open WebUI's timestamps are epoch seconds
  const d = typeof v === 'number' || /^\d{9,11}$/.test(String(v)) ? new Date(Number(v) * 1000) : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

function toRow(o: Record<string, unknown>, line: number): ImportRow | string {
  const content = typeof o.content === 'string' ? o.content.trim() : typeof o.memory === 'string' ? o.memory.trim() : '';
  if (!content) return 'missingContent';
  if (content.length > LIMITS.content) return 'contentTooLong';
  return {
    line,
    title: typeof o.title === 'string' && o.title.trim() ? o.title.trim().slice(0, LIMITS.title) : null,
    content,
    category: typeof o.category === 'string' && o.category.trim() ? o.category.trim().toLowerCase() : null,
    namespace: typeof o.namespace === 'string' && o.namespace.trim() ? o.namespace.trim().toLowerCase() : null,
    importance: numOrNull(o.importance),
    confidence: numOrNull(o.confidence),
    expiresAt: dateOrNull(o.expiresAt ?? o.expires_at),
    pinned: truthy(o.pinned ?? o.isPinned),
    locked: truthy(o.locked ?? o.isLocked),
    externalId: o.id !== undefined && o.id !== null ? String(o.id).slice(0, 200) : null,
    createdAt: dateOrNull(o.createdAt ?? o.created_at),
  };
}

export function parseImport(format: ImportFormat, text: string): ParsedImport {
  const rows: ImportRow[] = [];
  const errors: { line: number; error: string }[] = [];
  const add = (o: unknown, line: number) => {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return errors.push({ line, error: 'notAnObject' });
    const r = toRow(o as Record<string, unknown>, line);
    if (typeof r === 'string') errors.push({ line, error: r });
    else rows.push(r);
  };
  try {
    if (format === 'jsonl') {
      text.split(/\r?\n/).forEach((l, i) => {
        if (!l.trim()) return;
        try {
          add(JSON.parse(l), i + 1);
        } catch {
          errors.push({ line: i + 1, error: 'notJson' });
        }
      });
    } else if (format === 'csv') {
      const table = parseCsv(text);
      const header = (table.shift() ?? []).map((h) => h.trim());
      if (!header.includes('content')) return { rows, errors: [{ line: 1, error: 'noContentColumn' }] };
      table.forEach((cells, i) => add(Object.fromEntries(header.map((h, j) => [h, cells[j] ?? ''])), i + 2));
    } else {
      const parsed = JSON.parse(text) as unknown;
      const list = Array.isArray(parsed) ? parsed : ((parsed as { memories?: unknown[]; items?: unknown[] })?.memories ?? (parsed as { items?: unknown[] })?.items);
      if (!Array.isArray(list)) return { rows, errors: [{ line: 1, error: 'noList' }] };
      list.forEach((o, i) => add(o, i + 1));
    }
  } catch {
    return { rows, errors: [{ line: 1, error: 'notJson' }] };
  }
  if (rows.length > MAX_IMPORT_ROWS) {
    errors.push({ line: rows[MAX_IMPORT_ROWS].line, error: 'tooManyRows' });
    rows.length = MAX_IMPORT_ROWS;
  }
  return { rows, errors };
}

// ---- Export serializing ----

export type ExportMemory = Record<string, string | number | boolean | null | object>;

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  // A cell starting with = + - @ is quoted with a leading apostrophe so a spreadsheet never runs it as a formula
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function serialize(format: 'json' | 'jsonl' | 'csv', items: ExportMemory[], meta: Record<string, unknown>): string {
  if (format === 'json') return JSON.stringify({ ...meta, memories: items }, null, 2);
  if (format === 'jsonl') return items.map((i) => JSON.stringify(i)).join('\n') + (items.length ? '\n' : '');
  const columns = [...new Set(items.flatMap((i) => Object.keys(i)))];
  return [columns.join(','), ...items.map((i) => columns.map((c) => csvCell(i[c])).join(','))].join('\n') + '\n';
}

// ---- Retrieval metrics ----

export function precisionAtK(retrieved: string[], relevant: Set<string>, k: number): number | null {
  const top = retrieved.slice(0, k);
  if (!top.length) return relevant.size ? 0 : null;
  return top.filter((id) => relevant.has(id)).length / top.length;
}

export function recallAtK(retrieved: string[], relevant: Set<string>, k: number): number | null {
  if (!relevant.size) return null;
  return retrieved.slice(0, k).filter((id) => relevant.has(id)).length / relevant.size;
}

export function reciprocalRank(retrieved: string[], relevant: Set<string>): number | null {
  if (!relevant.size) return null;
  const i = retrieved.findIndex((id) => relevant.has(id));
  return i < 0 ? 0 : 1 / (i + 1);
}

// Retrieved memories the case says must not appear (e.g. another namespace's): any is a failure
export function excludedRate(retrieved: string[], excluded: Set<string>): number | null {
  if (!excluded.size) return null;
  return retrieved.filter((id) => excluded.has(id)).length / Math.max(1, retrieved.length);
}

// Deterministic: the share of the expected answer's content words found in the answer
export function answerOverlap(answer: string, expected: string): number | null {
  const words = (t: string) => new Set((normalizeContent(t).match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter((w) => !STOP.has(w)));
  const e = words(expected);
  if (!e.size) return null;
  const a = words(answer);
  return [...e].filter((w) => a.has(w)).length / e.size;
}
const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'are', 'was', 'has', 'have', 'from', 'its', 'not', 'but', 'you', 'your']);

export const mean = (values: (number | null)[]) => {
  const v = values.filter((x): x is number => x !== null && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

// ---- Fine-tuning datasets ----

export type TrainingSource = {
  id: string;
  version: number;
  title: string;
  content: string;
  categoryKey: string;
  namespacePath: string;
  isCustomerData: boolean;
  isSensitive: boolean;
  group: string;
};

export type TrainingExample = {
  split: 'train' | 'valid' | 'test';
  instruction: { instruction: string; input: string; output: string };
  chat: { messages: { role: 'system' | 'user' | 'assistant'; content: string }[] };
  provenance: { memoryId: string; version: number; namespace: string; category: string; contentHash: string; group: string };
};

export type DatasetOptions = { system: string; split: { train: number; valid: number; test: number }; seed: string; allowCustomerData: boolean };

const QUESTION: Record<string, (title: string) => string> = {
  procedural: (t) => `How do I do this: ${t}?`,
  preference: (t) => `What is my preference about ${t.toLowerCase()}?`,
  decision: (t) => `What was decided about ${t.toLowerCase()}, and why?`,
  instruction: (t) => `What is the standing instruction about ${t.toLowerCase()}?`,
};

// A memory's group goes wholly into one split (hash of the group and seed), so related examples (versions,
// relationships, one namespace's procedure) never leak between train and test
export function splitOf(group: string, seed: string, split: DatasetOptions['split']): 'train' | 'valid' | 'test' {
  const total = split.train + split.valid + split.test;
  const h = parseInt(createHash('sha256').update(`${seed}:${group}`).digest('hex').slice(0, 8), 16) / 0xffffffff;
  if (h < split.train / total) return 'train';
  if (h < (split.train + split.valid) / total) return 'valid';
  return 'test';
}

export function buildDataset(sources: TrainingSource[], o: DatasetOptions): { examples: TrainingExample[]; excluded: { id: string; reason: string }[] } {
  const examples: TrainingExample[] = [];
  const excluded: { id: string; reason: string }[] = [];
  const seen = new Set<string>();
  for (const s of sources) {
    if (s.isCustomerData && !o.allowCustomerData) {
      excluded.push({ id: s.id, reason: 'customerData' });
      continue;
    }
    if (s.isSensitive || detectSensitive(`${s.title}\n${s.content}`).sensitivity !== 'none') {
      excluded.push({ id: s.id, reason: 'sensitive' });
      continue;
    }
    const hash = createHash('sha256').update(normalizeContent(s.content)).digest('hex');
    if (seen.has(hash)) {
      excluded.push({ id: s.id, reason: 'duplicate' });
      continue;
    }
    seen.add(hash);
    const question = (QUESTION[s.categoryKey] ?? ((t: string) => `What do you know about ${t.replace(/[.?!]+$/, '').toLowerCase()}?`))(s.title.replace(/[.?!]+$/, ''));
    examples.push({
      split: splitOf(s.group, o.seed, o.split),
      instruction: { instruction: question, input: '', output: s.content },
      chat: {
        messages: [
          { role: 'system', content: o.system },
          { role: 'user', content: question },
          { role: 'assistant', content: s.content },
        ],
      },
      provenance: { memoryId: s.id, version: s.version, namespace: s.namespacePath, category: s.categoryKey, contentHash: hash.slice(0, 16), group: s.group },
    });
  }
  return { examples, excluded };
}

// No group in more than one split, and no answer text in both train and test
export function checkContamination(examples: TrainingExample[]): { groupsAcrossSplits: string[]; duplicateAnswersAcrossSplits: number } {
  const groupSplits = new Map<string, Set<string>>();
  const answerSplits = new Map<string, Set<string>>();
  for (const e of examples) {
    (groupSplits.get(e.provenance.group) ?? groupSplits.set(e.provenance.group, new Set()).get(e.provenance.group)!).add(e.split);
    const a = normalizeContent(e.instruction.output);
    (answerSplits.get(a) ?? answerSplits.set(a, new Set()).get(a)!).add(e.split);
  }
  return {
    groupsAcrossSplits: [...groupSplits].filter(([, s]) => s.size > 1).map(([g]) => g),
    duplicateAnswersAcrossSplits: [...answerSplits.values()].filter((s) => s.size > 1).length,
  };
}
