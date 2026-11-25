import { ApiError } from './api';
import { isUuid, LIMITS, MEMORY_STATUSES, type MemoryStatus } from './rules';
import type { CreateInput, MemoryFilters, MemoryPatch } from './store';

// Request-body checks shared by the Memory API's routes: anything not matching is a 400, never passed on

export const str = (v: unknown, max: number, field: string, required = false): string | undefined => {
  if (v === undefined || v === null || v === '') {
    if (required) throw new ApiError(400, 'invalid', `${field} is required`);
    return undefined;
  }
  if (typeof v !== 'string' || v.length > max) throw new ApiError(400, 'invalid', `${field} must be text of at most ${max} characters`);
  return v;
};
export const int = (v: unknown, min: number, max: number, field: string): number | undefined => {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new ApiError(400, 'invalid', `${field} must be between ${min} and ${max}`);
  return n;
};
export const bool = (v: unknown, field: string): boolean | undefined => {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'boolean') throw new ApiError(400, 'invalid', `${field} must be true or false`);
  return v;
};
export const uuid = (v: unknown, field: string, required = false): string | undefined => {
  if (v === undefined || v === null || v === '') {
    if (required) throw new ApiError(400, 'invalid', `${field} is required`);
    return undefined;
  }
  if (!isUuid(v)) throw new ApiError(400, 'invalid', `${field} must be an ID`);
  return v;
};
export const date = (v: unknown, field: string): string | null | undefined => {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) throw new ApiError(400, 'invalid', `${field} must be a date`);
  return d.toISOString();
};
export const list = (v: unknown, field: string, max = 200): string[] | undefined => {
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v) || v.length > max || !v.every((x) => typeof x === 'string' && x.length <= 200)) throw new ApiError(400, 'invalid', `${field} must be a list`);
  return v as string[];
};

export function createInput(b: Record<string, unknown>, namespaceId: string, categoryId: string): CreateInput {
  const metadata = b.metadata;
  if (metadata !== undefined && (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata) || JSON.stringify(metadata).length > LIMITS.metadataBytes)) {
    throw new ApiError(400, 'invalid', 'metadata must be an object under 8 KB');
  }
  return {
    title: str(b.title, LIMITS.title, 'title') ?? null,
    content: str(b.content, LIMITS.content, 'content', true)!,
    summary: str(b.summary, LIMITS.summary, 'summary') ?? null,
    namespaceId,
    categoryId,
    importance: int(b.importance, 1, 10, 'importance'),
    confidence: int(b.confidence, 0, 1, 'confidence'),
    isPinned: bool(b.isPinned, 'isPinned'),
    isLocked: bool(b.isLocked, 'isLocked'),
    isSensitive: bool(b.isSensitive, 'isSensitive'),
    expiresAt: date(b.expiresAt, 'expiresAt'),
    sourceModel: str(b.sourceModel, 100, 'sourceModel') ?? null,
    sourceConversationId: str(b.sourceConversationId, 200, 'sourceConversationId') ?? null,
    sourceMessageId: str(b.sourceMessageId, 200, 'sourceMessageId') ?? null,
    sourceReference: str(b.sourceReference, 500, 'sourceReference') ?? null,
    metadata: metadata as Record<string, unknown> | undefined,
  };
}

export function patchInput(b: Record<string, unknown>): MemoryPatch {
  const status = b.status;
  if (status !== undefined && !(MEMORY_STATUSES as readonly unknown[]).includes(status)) throw new ApiError(400, 'invalid', 'Unknown status');
  const out: MemoryPatch = {
    title: str(b.title, LIMITS.title, 'title'),
    content: str(b.content, LIMITS.content, 'content'),
    summary: b.summary === null ? null : str(b.summary, LIMITS.summary, 'summary'),
    namespaceId: uuid(b.namespaceId, 'namespaceId'),
    categoryId: uuid(b.categoryId, 'categoryId'),
    importance: int(b.importance, 1, 10, 'importance'),
    confidence: int(b.confidence, 0, 1, 'confidence'),
    isPinned: bool(b.isPinned, 'isPinned'),
    isLocked: bool(b.isLocked, 'isLocked'),
    isActive: bool(b.isActive, 'isActive'),
    isSensitive: bool(b.isSensitive, 'isSensitive'),
    expiresAt: date(b.expiresAt, 'expiresAt'),
    lastVerifiedAt: date(b.lastVerifiedAt, 'lastVerifiedAt'),
    status: status as MemoryStatus | undefined,
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined)) as MemoryPatch;
}

export function filtersFrom(sp: { str: (k: string, m?: number) => string | undefined; num: (k: string) => number | undefined; bool: (k: string) => boolean | undefined; list: (k: string) => string[] }): MemoryFilters {
  const sort = sp.str('sort') as MemoryFilters['sort'];
  return {
    q: sp.str('q', LIMITS.query),
    categoryIds: sp.list('category').filter(isUuid),
    statuses: sp.list('status').filter((s): s is MemoryStatus => (MEMORY_STATUSES as readonly string[]).includes(s)),
    pinned: sp.bool('pinned'),
    locked: sp.bool('locked'),
    sensitive: sp.bool('sensitive'),
    active: sp.bool('active'),
    expiring: ((v) => (v === 'expired' || v === 'soon' || v === 'never' ? v : undefined))(sp.str('expiring')),
    sourceApplication: sp.str('sourceApplication', 60),
    sourceModel: sp.str('sourceModel', 100),
    minImportance: sp.num('minImportance'),
    maxImportance: sp.num('maxImportance'),
    minConfidence: sp.num('minConfidence'),
    createdFrom: sp.str('createdFrom', 40),
    createdTo: sp.str('createdTo', 40),
    accessedFrom: sp.str('accessedFrom', 40),
    accessedTo: sp.str('accessedTo', 40),
    sort: sort && ['created', 'updated', 'accessed', 'importance', 'confidence', 'accessCount', 'title', 'expires'].includes(sort) ? sort : undefined,
    direction: sp.str('direction') === 'asc' ? 'asc' : 'desc',
    limit: sp.num('limit'),
    offset: sp.num('offset'),
  };
}

// A retrieval profile's targets
export function cleanAppliesTo(v: unknown) {
  const o = (v ?? {}) as Record<string, unknown>;
  const l = (x: unknown) => (Array.isArray(x) ? x.filter((s) => typeof s === 'string' && s.length <= 100).slice(0, 50) : []);
  return { models: l(o.models), applications: l(o.applications), namespaces: l(o.namespaces) };
}
