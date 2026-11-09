import { createHash } from 'node:crypto';
import {
  AUTHORITIES,
  CAR_CLASSES,
  COMPONENTS,
  LICENSES,
  PHASES,
  SIMULATORS,
  SYMPTOMS,
  VERIFICATIONS,
  type Authority,
  type CarClass,
  type Component,
  type EngineeringRecord,
  type KnowledgeSource,
  type Phase,
  type SimulatorId,
  type Symptom,
  type Verification,
} from './knowledgeTypes.ts';
import { estimateTokens, recordToChunk, sanitizeKnowledgeText } from './retrieval.ts';
import { carMatchKey, PARAMETER_LABELS } from './setupCapabilities.ts';

// Turns engineering documents into what the knowledge base stores: one NormalizedDocument per document, with its
// metadata validated and its text cut into chunks. Formats: structured JSON records (one record or an array, the
// starter corpus's shape), Markdown with a front matter block, plain text with the same front matter, and PDF text
// (extracted by scripts/engineeringKnowledge.mjs). Pure apart from hashing, so `node --test` runs it.
//
// Rules: every document names a source whose licence allows storing it ('unknown' is refused); car-specific
// knowledge must say which cars; nothing claims to be reviewed unless its front matter says a person reviewed it, and
// uploaded documents default to 'unverified'. Text that reads like instructions to a model is taken out
// (sanitizeKnowledgeText) before it's stored.

export type DocumentFormat = 'record' | 'markdown' | 'text' | 'pdf';

export type NormalizedChunk = { index: number; title: string; text: string; tokens: number; hash: string };

export type NormalizedDocument = {
  key: string;
  version: number;
  title: string;
  sourceKey: string;
  format: DocumentFormat;
  authority: Authority;
  verification: Verification;
  simulators: (SimulatorId | 'any')[];
  carClasses: (CarClass | 'any')[];
  cars: string[];
  components: Component[];
  phases: Phase[];
  symptoms: Symptom[];
  content: string;
  record: EngineeringRecord | null;
  hash: string;
  chunks: NormalizedChunk[];
};

export class IngestionError extends Error {}

export const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

// Chunks of about this many tokens, with one paragraph carried over between neighbours
export const CHUNK_TOKENS = 350;
// The most one document may have, so an upload can't run up the embedding bill
export const MAX_CHUNKS_PER_DOCUMENT = 200;
export const MAX_DOCUMENT_CHARS = 400_000;

const KEY_RE = /^[a-z0-9][a-z0-9-]{1,99}$/;

function list<T extends string>(value: unknown, allowed: readonly T[], field: string, any = true): (T | 'any')[] {
  const items = (Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : []).map((v) => String(v).trim()).filter(Boolean);
  for (const item of items) {
    if (!(allowed as readonly string[]).includes(item) && !(any && item === 'any')) {
      throw new IngestionError(`Unknown ${field} "${item}" (allowed: ${[...(any ? ['any'] : []), ...allowed].join(', ')})`);
    }
  }
  return items as (T | 'any')[];
}

function one<T extends string>(value: unknown, allowed: readonly T[], field: string, fallback: T): T {
  if (value == null || value === '') return fallback;
  const v = String(value).trim();
  if (!(allowed as readonly string[]).includes(v)) throw new IngestionError(`Unknown ${field} "${v}" (allowed: ${allowed.join(', ')})`);
  return v as T;
}

type Meta = Record<string, unknown>;

// "--- key: value / key: [a, b] ---" at the top of a Markdown or text document
export function parseFrontMatter(text: string): { meta: Meta; body: string } {
  const match = /^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) return { meta: {}, body: text };
  const meta: Meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const m = /^([A-Za-z][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(line.trim());
    if (!m) continue;
    const raw = m[2].trim();
    meta[m[1]] = raw.startsWith('[') && raw.endsWith(']') ? raw.slice(1, -1).split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean) : raw.replace(/^["']|["']$/g, '');
  }
  return { meta, body: text.slice(match[0].length) };
}

// Sections by Markdown heading, then paragraphs packed into chunks of about CHUNK_TOKENS, each chunk titled by its
// section, with the last paragraph of a chunk repeated at the start of the next so no idea is cut in two
export function chunkText(title: string, body: string, maxTokens = CHUNK_TOKENS): { title: string; text: string }[] {
  const sections: { heading: string; paragraphs: string[] }[] = [];
  let current = { heading: title, paragraphs: [] as string[] };
  for (const block of body.replace(/\r\n/g, '\n').split(/\n{2,}/)) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    const heading = /^#{1,6}\s+(.+)$/.exec(trimmed.split('\n')[0]);
    if (heading) {
      if (current.paragraphs.length) sections.push(current);
      current = { heading: `${title}: ${heading[1].trim()}`, paragraphs: [] };
      const rest = trimmed.split('\n').slice(1).join('\n').trim();
      if (rest) current.paragraphs.push(rest);
      continue;
    }
    current.paragraphs.push(trimmed);
  }
  if (current.paragraphs.length) sections.push(current);

  const chunks: { title: string; text: string }[] = [];
  for (const section of sections) {
    let parts: string[] = [];
    let tokens = 0;
    for (const paragraph of section.paragraphs.flatMap((p) => splitLong(p, maxTokens))) {
      const cost = estimateTokens(paragraph);
      if (tokens + cost > maxTokens && parts.length) {
        chunks.push({ title: section.heading, text: parts.join('\n\n') });
        const carry = parts[parts.length - 1];
        parts = estimateTokens(carry) < maxTokens / 2 ? [carry] : [];
        tokens = parts.length ? estimateTokens(carry) : 0;
      }
      parts.push(paragraph);
      tokens += cost;
    }
    if (parts.length) chunks.push({ title: section.heading, text: parts.join('\n\n') });
  }
  return chunks;
}

// A paragraph longer than a chunk, cut at sentence ends
function splitLong(paragraph: string, maxTokens: number): string[] {
  if (estimateTokens(paragraph) <= maxTokens) return [paragraph];
  const sentences = paragraph.split(/(?<=[.!?])\s+/);
  const out: string[] = [];
  let part = '';
  for (const s of sentences) {
    if (part && estimateTokens(part + ' ' + s) > maxTokens) {
      out.push(part);
      part = '';
    }
    part = part ? `${part} ${s}` : s.slice(0, maxTokens * 4);
  }
  if (part) out.push(part);
  return out;
}

function finish(doc: Omit<NormalizedDocument, 'hash' | 'chunks'>, pieces: { title: string; text: string }[]): NormalizedDocument {
  if (pieces.length === 0) throw new IngestionError(`${doc.key} has no text`);
  if (pieces.length > MAX_CHUNKS_PER_DOCUMENT) throw new IngestionError(`${doc.key} has ${pieces.length} chunks; the most is ${MAX_CHUNKS_PER_DOCUMENT}`);
  if (doc.cars.length && doc.carClasses.includes('any')) throw new IngestionError(`${doc.key} names cars, so it must name their class too`);
  if (doc.verification === 'reviewed' && doc.authority === 'hypothesis') throw new IngestionError(`${doc.key}: a hypothesis can't be marked reviewed; make it car_verified or general_principle`);
  const chunks = pieces.map((p, index) => ({ index, title: p.title, text: p.text, tokens: estimateTokens(p.text), hash: sha256(`${p.title}\n${p.text}`) }));
  // The hash covers the metadata too, so retagging a document is a new version
  const hash = sha256(JSON.stringify({ ...doc, record: doc.record, chunks: chunks.map((c) => c.hash) }));
  return { ...doc, hash, chunks };
}

export function validateSource(source: KnowledgeSource): KnowledgeSource {
  if (!KEY_RE.test(source.key)) throw new IngestionError(`Source key "${source.key}" must be lowercase letters, digits and dashes`);
  if (!source.title?.trim()) throw new IngestionError(`Source ${source.key} has no title`);
  one(source.license, LICENSES, 'license', 'unknown');
  if (source.license === 'unknown') throw new IngestionError(`Source ${source.key} has an unknown licence: only original, cc-by, permitted or public-docs-link-only content can be stored`);
  if (source.url && !/^https:\/\/[^\s]+$/.test(source.url)) throw new IngestionError(`Source ${source.key} has a URL that isn't https`);
  return source;
}

// A structured record (the starter corpus's shape)
export function normalizeRecord(input: unknown): NormalizedDocument {
  const r = input as EngineeringRecord;
  if (!r || typeof r !== 'object') throw new IngestionError('A record must be an object');
  if (!KEY_RE.test(r.id ?? '')) throw new IngestionError(`Record id "${r.id}" must be lowercase letters, digits and dashes`);
  if (!r.title || !r.summary) throw new IngestionError(`Record ${r.id} needs a title and summary`);
  const record: EngineeringRecord = {
    ...r,
    version: Number.isInteger(r.version) && r.version > 0 ? r.version : 1,
    authority: one(r.authority, AUTHORITIES, 'authority', 'general_principle'),
    verification: one(r.verification, VERIFICATIONS, 'verification', 'unverified'),
    simulators: list(r.simulators ?? ['any'], SIMULATORS, 'simulator') as EngineeringRecord['simulators'],
    carClasses: list(r.carClasses ?? ['any'], CAR_CLASSES, 'car class') as EngineeringRecord['carClasses'],
    cars: (r.cars ?? []).map(carMatchKey).filter(Boolean),
    components: list(r.components ?? [], COMPONENTS, 'component', false) as Component[],
    phases: list(r.phases ?? [], PHASES, 'phase', false) as Phase[],
    symptoms: list(r.symptoms ?? [], SYMPTOMS, 'symptom', false) as Symptom[],
    summary: sanitizeKnowledgeText(r.summary),
    causes: (r.causes ?? []).map(sanitizeKnowledgeText),
    telemetryIndicators: (r.telemetryIndicators ?? []).map(sanitizeKnowledgeText),
    adjustments: (r.adjustments ?? []).map((a) => ({ ...a })),
    drivingCorrections: (r.drivingCorrections ?? []).map(sanitizeKnowledgeText),
    constraints: (r.constraints ?? []).map(sanitizeKnowledgeText),
    sources: r.sources?.length ? r.sources : [],
  };
  if (record.sources.length === 0) throw new IngestionError(`Record ${r.id} names no source`);
  for (const a of record.adjustments) {
    if (!Object.hasOwn(PARAMETER_LABELS, a?.parameter)) throw new IngestionError(`Record ${r.id} adjusts an unknown parameter "${a?.parameter}"`);
    a.direction = sanitizeKnowledgeText(String(a.direction ?? ''));
    a.effect = sanitizeKnowledgeText(String(a.effect ?? ''));
    a.tradeoff = sanitizeKnowledgeText(String(a.tradeoff ?? ''));
  }
  const chunk = recordToChunk(record);
  return finish(
    {
      key: record.id,
      version: record.version,
      title: record.title,
      sourceKey: record.sources[0],
      format: 'record',
      authority: record.authority,
      verification: record.verification,
      simulators: record.simulators,
      carClasses: record.carClasses,
      cars: record.cars,
      components: record.components,
      phases: record.phases,
      symptoms: record.symptoms,
      content: chunk.text,
      record,
    },
    [{ title: record.title, text: chunk.text }]
  );
}

// A Markdown, text or PDF document with front matter (or meta given alongside, e.g. by the Admin page's upload form)
export function normalizeTextDocument(text: string, format: Exclude<DocumentFormat, 'record'>, extraMeta: Meta = {}): NormalizedDocument {
  if (text.length > MAX_DOCUMENT_CHARS) throw new IngestionError(`The document is over ${MAX_DOCUMENT_CHARS} characters`);
  const { meta: front, body } = parseFrontMatter(text);
  const meta = { ...front, ...Object.fromEntries(Object.entries(extraMeta).filter(([, v]) => v != null && v !== '')) };
  const key = String(meta.key ?? '').trim();
  if (!KEY_RE.test(key)) throw new IngestionError('The document needs a key (lowercase letters, digits and dashes)');
  const title = String(meta.title ?? '').trim();
  if (!title) throw new IngestionError(`${key} needs a title`);
  const sourceKey = String(meta.source ?? '').trim();
  if (!sourceKey) throw new IngestionError(`${key} needs a source`);
  const clean = sanitizeKnowledgeText(body);
  return finish(
    {
      key,
      version: Number(meta.version) > 0 ? Math.floor(Number(meta.version)) : 1,
      title,
      sourceKey,
      format,
      authority: one(meta.authority, AUTHORITIES, 'authority', 'general_principle'),
      // Uploads are unverified until a person reviews them on the Admin page
      verification: one(meta.verification, VERIFICATIONS, 'verification', 'unverified'),
      simulators: list(meta.simulators ?? ['any'], SIMULATORS, 'simulator') as NormalizedDocument['simulators'],
      carClasses: list(meta.carClasses ?? ['any'], CAR_CLASSES, 'car class') as NormalizedDocument['carClasses'],
      cars: (Array.isArray(meta.cars) ? meta.cars : meta.cars ? [meta.cars] : []).map((c) => carMatchKey(String(c))).filter(Boolean),
      components: list(meta.components ?? [], COMPONENTS, 'component', false) as Component[],
      phases: list(meta.phases ?? [], PHASES, 'phase', false) as Phase[],
      symptoms: list(meta.symptoms ?? [], SYMPTOMS, 'symptom', false) as Symptom[],
      content: clean,
      record: null,
    },
    chunkText(title, clean)
  );
}

// A JSON file: one record or an array of them
export function normalizeJson(text: string): NormalizedDocument[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new IngestionError('The file is not valid JSON');
  }
  const records = Array.isArray(parsed) ? parsed : [parsed];
  if (records.length > 500) throw new IngestionError('At most 500 records a file');
  return records.map(normalizeRecord);
}
