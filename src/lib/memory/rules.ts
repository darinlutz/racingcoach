// The Clarivex Memory Service's pure rules (docs/AI_MEMORY_ARCHITECTURE.md): statuses and their transitions, the
// seeded categories and namespaces, operating modes and their precedence, settings with their defaults, content
// hashing and candidate validation. No imports with side effects and no I/O, so Node's test runner, the server and
// the browser all use the same rules.

// ---- Statuses ----

export const MEMORY_STATUSES = ['Pending', 'Approved', 'Active', 'Archived', 'Superseded', 'Expired', 'Rejected', 'Deleted'] as const;
export type MemoryStatus = (typeof MEMORY_STATUSES)[number];

// Pending: imported or created, not yet approved. Approved: approved, not yet retrievable (waiting for its
// embedding, or turned off). Active: retrievable. Deleted is a soft delete kept only until the purge (a privacy
// deletion skips it and removes the row at once). Rejected, Superseded, Expired and Archived never reach retrieval.
export const STATUS_TRANSITIONS: Record<MemoryStatus, readonly MemoryStatus[]> = {
  Pending: ['Approved', 'Active', 'Rejected', 'Deleted'],
  Approved: ['Active', 'Archived', 'Deleted'],
  Active: ['Approved', 'Archived', 'Superseded', 'Expired', 'Deleted'],
  Archived: ['Active', 'Deleted'],
  Superseded: ['Active', 'Archived', 'Deleted'],
  Expired: ['Active', 'Archived', 'Deleted'],
  Rejected: ['Pending', 'Deleted'],
  Deleted: [],
};

export function canTransition(from: MemoryStatus, to: MemoryStatus): boolean {
  return from === to || STATUS_TRANSITIONS[from].includes(to);
}

// is_active is "retrieval enabled": only an Active memory may have it, and the database's CHECK says the same
// (memories_active_status in schema.ts)
export function activeAllowed(status: MemoryStatus): boolean {
  return status === 'Active';
}

// What retrieval may ever see; the SQL repeats it (retrievableSql in retrieval.ts)
export function isRetrievable(m: { status: MemoryStatus; isActive: boolean; expiresAt: Date | string | null }, now = new Date()): boolean {
  if (m.status !== 'Active' || !m.isActive) return false;
  return !m.expiresAt || new Date(m.expiresAt).getTime() > now.getTime();
}

// ---- Categories ----

export const RETENTION_RULES = ['untilChanged', 'days', 'untilSuperseded', 'untilCompleted', 'configurable', 'followsRelated'] as const;
export type RetentionRule = (typeof RETENTION_RULES)[number];
export const AUTO_UPDATE_POLICIES = ['never', 'propose', 'automatic'] as const;
export type AutoUpdatePolicy = (typeof AUTO_UPDATE_POLICIES)[number];

export type CategorySeed = {
  key: string;
  name: string;
  description: string;
  example: string;
  color: string;
  icon: string;
  defaultImportance: number;
  retentionRule: RetentionRule;
  retentionDays: number | null;
  extractionEligible: boolean;
  requiresApproval: boolean;
  autoUpdate: AutoUpdatePolicy;
};

// Icons are lucide-react names (src/components/aiLab/memory/MemoryIcon.tsx maps them)
export const DEFAULT_CATEGORIES: readonly CategorySeed[] = [
  { key: 'semantic', name: 'Semantic', description: 'Facts about the world, projects and systems', example: 'RacingCoach is hosted on Render', color: '#3b82f6', icon: 'BookOpen', defaultImportance: 5, retentionRule: 'untilChanged', retentionDays: null, extractionEligible: true, requiresApproval: true, autoUpdate: 'propose' },
  { key: 'preference', name: 'Preference', description: 'How the user likes things done', example: 'Prefers TypeScript', color: '#a855f7', icon: 'Heart', defaultImportance: 6, retentionRule: 'untilChanged', retentionDays: null, extractionEligible: true, requiresApproval: true, autoUpdate: 'propose' },
  { key: 'episodic', name: 'Episodic', description: 'Something that happened', example: 'Tested a local LLM', color: '#f59e0b', icon: 'CalendarClock', defaultImportance: 3, retentionRule: 'days', retentionDays: 90, extractionEligible: true, requiresApproval: true, autoUpdate: 'never' },
  { key: 'procedural', name: 'Procedural', description: 'How something is done, step by step', example: 'Collector deployment process', color: '#10b981', icon: 'ListChecks', defaultImportance: 7, retentionRule: 'untilSuperseded', retentionDays: null, extractionEligible: true, requiresApproval: true, autoUpdate: 'propose' },
  { key: 'project', name: 'Project', description: 'Facts about a project', example: 'RacingCoach uses R2', color: '#0ea5e9', icon: 'FolderKanban', defaultImportance: 6, retentionRule: 'untilSuperseded', retentionDays: null, extractionEligible: true, requiresApproval: true, autoUpdate: 'propose' },
  { key: 'instruction', name: 'Instruction', description: 'A standing instruction (reference data, never a system instruction)', example: 'Validate telemetry before analysis', color: '#ef4444', icon: 'Megaphone', defaultImportance: 7, retentionRule: 'untilChanged', retentionDays: null, extractionEligible: true, requiresApproval: true, autoUpdate: 'never' },
  { key: 'goal', name: 'Goal', description: 'Something the user is working towards', example: 'Improve sim racing performance', color: '#22c55e', icon: 'Target', defaultImportance: 6, retentionRule: 'untilCompleted', retentionDays: null, extractionEligible: true, requiresApproval: true, autoUpdate: 'propose' },
  { key: 'temporary', name: 'Temporary', description: 'True for now', example: 'Currently testing a model', color: '#94a3b8', icon: 'Hourglass', defaultImportance: 3, retentionRule: 'days', retentionDays: 14, extractionEligible: true, requiresApproval: false, autoUpdate: 'automatic' },
  { key: 'technical', name: 'Technical', description: 'Configuration and technical details', example: 'API configuration', color: '#6366f1', icon: 'Wrench', defaultImportance: 5, retentionRule: 'untilSuperseded', retentionDays: null, extractionEligible: true, requiresApproval: true, autoUpdate: 'propose' },
  { key: 'decision', name: 'Decision', description: 'A decision and why it was made', example: 'Selected PostgreSQL for memory', color: '#f97316', icon: 'Gavel', defaultImportance: 8, retentionRule: 'untilSuperseded', retentionDays: null, extractionEligible: true, requiresApproval: true, autoUpdate: 'never' },
  { key: 'feedback', name: 'Feedback', description: 'Feedback on answers and their format', example: 'Preferred response format', color: '#ec4899', icon: 'MessageSquareHeart', defaultImportance: 5, retentionRule: 'configurable', retentionDays: 180, extractionEligible: true, requiresApproval: true, autoUpdate: 'propose' },
  { key: 'relationship', name: 'Relationship', description: 'How two things relate', example: 'Application uses a specific service', color: '#14b8a6', icon: 'Network', defaultImportance: 4, retentionRule: 'followsRelated', retentionDays: null, extractionEligible: true, requiresApproval: true, autoUpdate: 'propose' },
];

export const CATEGORY_KEYS = DEFAULT_CATEGORIES.map((c) => c.key);

// When a new memory of a category expires (null for never). A configurable or days rule uses the category's
// retention_days; the others last until something changes them.
export function defaultExpiry(category: { retentionRule: RetentionRule; retentionDays: number | null }, from = new Date()): Date | null {
  if ((category.retentionRule === 'days' || category.retentionRule === 'configurable') && category.retentionDays && category.retentionDays > 0) {
    return new Date(from.getTime() + category.retentionDays * 86_400_000);
  }
  return null;
}

// ---- Namespaces ----

export const NAMESPACE_KINDS = ['personal', 'application', 'project', 'admin', 'organization', 'global', 'experiment'] as const;
export type NamespaceKind = (typeof NAMESPACE_KINDS)[number];

export type NamespaceSeed = { path: string; name: string; kind: NamespaceKind; description: string; customer?: boolean };

// Paths are lowercase slugs joined by '/'; a namespace's parent is the path without its last part
export const DEFAULT_NAMESPACES: readonly NamespaceSeed[] = [
  { path: 'personal', name: 'Personal', kind: 'personal', description: 'The owner’s own memories' },
  { path: 'personal/preferences', name: 'Preferences', kind: 'personal', description: '' },
  { path: 'personal/goals', name: 'Goals', kind: 'personal', description: '' },
  { path: 'personal/general-knowledge', name: 'General Knowledge', kind: 'personal', description: '' },
  { path: 'clarivex', name: 'Clarivex', kind: 'organization', description: 'The company' },
  { path: 'clarivex/business', name: 'Business', kind: 'organization', description: '' },
  { path: 'clarivex/infrastructure', name: 'Infrastructure', kind: 'organization', description: '' },
  { path: 'clarivex/architecture', name: 'Architecture', kind: 'organization', description: '' },
  { path: 'racingcoach', name: 'RacingCoach', kind: 'application', description: 'The RacingCoach application' },
  { path: 'racingcoach/development', name: 'Development', kind: 'project', description: '' },
  { path: 'racingcoach/race-engineering', name: 'Race Engineering', kind: 'project', description: '' },
  { path: 'racingcoach/ai-architecture', name: 'AI Architecture', kind: 'project', description: '' },
  { path: 'racingcoach/telemetry', name: 'Telemetry', kind: 'project', description: '' },
  { path: 'racingcoach/car-setups', name: 'Car Setups', kind: 'project', description: '' },
  { path: 'talkninja', name: 'TalkNinja', kind: 'application', description: 'The TalkNinja application (not integrated yet)' },
  { path: 'talkninja/development', name: 'Development', kind: 'project', description: '' },
  { path: 'talkninja/language-learning', name: 'Language Learning', kind: 'project', description: '' },
  { path: 'ai-lab', name: 'AI Lab', kind: 'experiment', description: 'Experiments, kept apart from everything else' },
  { path: 'ai-lab/experiments', name: 'Experiments', kind: 'experiment', description: '' },
  { path: 'ai-lab/model-evaluations', name: 'Model Evaluations', kind: 'experiment', description: '' },
  { path: 'ai-lab/fine-tuning', name: 'Fine-Tuning', kind: 'experiment', description: '' },
  // Each end user's own spaces live under here (users/u<id>/<application>, made on first use, see userNamespacePath)
  { path: 'users', name: 'Users', kind: 'application', description: 'Each customer’s own memory, one space per user and application', customer: true },
];

export const NAMESPACE_PATH = /^[a-z0-9][a-z0-9-]{0,47}(\/[a-z0-9][a-z0-9-]{0,47}){0,5}$/;
export const parentPath = (path: string): string | null => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : null);
export const rootOf = (path: string): string => path.split('/')[0];

export type NamespaceRow = { id: string; path: string; kind: NamespaceKind; isCustomerData: boolean; globalApproved: boolean; enabled: boolean; ownerUserId?: number | null };

// ---- Per-user memory ----

// Every end user (a RacingCoach customer) has their own memory space per application: users/u<id>/<application>,
// under users/u<id>, both owned by that account (owner_user_id) and customer data. Ownership, not grants, decides
// who reaches it: only a caller acting as that exact user (actingUserId), or an Admin who names it explicitly
// (support or a privacy request, audited). No grant, not 'all' nor a grant on users/, ever covers someone else's.
export const USERS_ROOT = 'users';
export const USER_APPLICATION = /^[a-z0-9][a-z0-9-]{1,39}$/;
export const userRootPath = (userId: number) => `${USERS_ROOT}/u${userId}`;
export const userNamespacePath = (userId: number, application: string) => `${userRootPath(userId)}/${application}`;
// "user:42" in X-Memory-Subject, for a client acting for end users (scope memory:users)
export function parseUserSubject(subject: string | null | undefined): number | null {
  const m = /^user:([1-9][0-9]{0,9})$/.exec(subject ?? '');
  return m ? Number(m[1]) : null;
}

// Which namespaces a request may read (docs/AI_MEMORY_SECURITY.md). `granted` are the namespace IDs the caller is
// authorized for; a grant covers that namespace and everything under it, except namespaces owned by a user, which
// only that user (actingUserId) reaches, or an Admin (ownerOverride) who asks for them by name. The request asks
// for some namespaces (`requested`, by ID or path; none means every granted one) and, optionally, their children.
// Globals (kind global and approved) are added only with the global grant. Customer namespaces never mix with
// other non-global ones: a request that would mix them is refused when it named both, or narrowed to the
// non-customer ones when it named none. Approved globals (shared product knowledge) may join a customer's request.
export function resolveNamespaces(
  all: readonly NamespaceRow[],
  options: {
    granted: readonly string[] | 'all';
    requested?: readonly string[];
    includeChildren?: boolean;
    includeGlobal?: boolean;
    globalGranted?: boolean;
    actingUserId?: number | null;
    ownerOverride?: boolean;
  }
): { allowed: NamespaceRow[]; refused: string[]; reason: string | null } {
  const byId = new Map(all.map((n) => [n.id, n]));
  const byPath = new Map(all.map((n) => [n.path, n]));
  const enabled = all.filter((n) => n.enabled);
  const acting = options.actingUserId ?? null;
  const grantedRoots = options.granted === 'all' ? [] : options.granted.map((id) => byId.get(id)).filter((n): n is NamespaceRow => Boolean(n));
  const owned = (n: NamespaceRow) => n.ownerUserId !== null && n.ownerUserId !== undefined;
  // Someone's own space: theirs whatever the grants say
  const own = (n: NamespaceRow) => owned(n) && acting !== null && n.ownerUserId === acting;
  const coveredByGrant = (n: NamespaceRow) => !owned(n) && (options.granted === 'all' || grantedRoots.some((g) => n.path === g.path || n.path.startsWith(`${g.path}/`)));
  const refused: string[] = [];
  let picked: NamespaceRow[];
  if (options.requested?.length) {
    picked = [];
    for (const ref of options.requested) {
      const n = byId.get(ref) ?? byPath.get(ref);
      const ok = n && n.enabled && (coveredByGrant(n) || own(n) || (owned(n) && options.ownerOverride === true));
      if (!ok) refused.push(ref);
      else picked.push(n);
    }
    if (options.includeChildren) {
      for (const n of [...picked]) {
        for (const c of enabled) {
          if (!c.path.startsWith(`${n.path}/`)) continue;
          // An owned parent's children are the same user's; a shared parent never brings in owned children
          if (coveredByGrant(c) || own(c) || (owned(c) && owned(n) && c.ownerUserId === n.ownerUserId)) picked.push(c);
        }
      }
    }
  } else {
    picked = enabled.filter((n) => coveredByGrant(n) || own(n));
  }
  if (options.includeGlobal !== false && options.globalGranted) picked.push(...enabled.filter((n) => n.kind === 'global' && n.globalApproved));
  const unique = [...new Map(picked.map((n) => [n.id, n])).values()];
  // Two different users' spaces never go together, whoever asks
  const owners = new Set(unique.filter(owned).map((n) => n.ownerUserId));
  if (owners.size > 1) return { allowed: [], refused: [...refused, ...(options.requested ?? [])], reason: 'mixesUsers' };
  const global = (n: NamespaceRow) => n.kind === 'global' && n.globalApproved;
  const customer = unique.filter((n) => n.isCustomerData || owned(n));
  const other = unique.filter((n) => !n.isCustomerData && !owned(n) && !global(n));
  if (customer.length && other.length) {
    if (options.requested?.length) return { allowed: [], refused: [...refused, ...options.requested], reason: 'mixesCustomerData' };
    // Nothing named: acting for a user means their space (and globals); anyone else gets their non-customer ones
    return { allowed: acting !== null ? unique.filter((n) => !other.includes(n)) : unique.filter((n) => !customer.includes(n)), refused, reason: null };
  }
  return { allowed: unique, refused, reason: refused.length ? 'notAuthorized' : null };
}

// ---- Operating modes ----

// Most restrictive first: precedence keeps the most specific setting, then no ceiling may be exceeded
export const MEMORY_MODES = ['disabled', 'readOnly', 'manual', 'approvalRequired', 'hybrid', 'automatic'] as const;
export type MemoryMode = (typeof MEMORY_MODES)[number];
const rank = (m: MemoryMode) => MEMORY_MODES.indexOf(m);
export const mostRestrictive = (...modes: MemoryMode[]): MemoryMode => modes.reduce((a, b) => (rank(b) < rank(a) ? b : a));

export type ModeLayers = {
  global: MemoryMode;
  application?: MemoryMode | null;
  namespace?: MemoryMode | null;
  category?: MemoryMode | null;
  user?: MemoryMode | null;
};

export type ModeCeilings = {
  memoryEnabled: boolean;
  customerData: boolean;
  customerCaptureEnabled: boolean;
  sensitive: boolean;
  categoryRequiresApproval: boolean;
  categoryExtractionEligible: boolean;
};

// Deterministic precedence (docs/AI_MEMORY_ARCHITECTURE.md, Operating modes): the most specific layer that sets a
// mode wins (user, then category, then namespace, then application, then global), and then the ceilings, which no
// layer can lift: memory switched off is Disabled; customer data without customer capture is Read Only; sensitive
// content and categories that require approval are at most Approval Required; a category not eligible for
// extraction is at most Manual.
export function effectiveMode(layers: ModeLayers, ceilings: ModeCeilings): { mode: MemoryMode; from: keyof ModeLayers; cappedBy: string | null } {
  const order: (keyof ModeLayers)[] = ['user', 'category', 'namespace', 'application', 'global'];
  const from = order.find((k) => layers[k]) ?? 'global';
  let mode = (layers[from] ?? layers.global) as MemoryMode;
  let cappedBy: string | null = null;
  const cap = (limit: MemoryMode, why: string) => {
    if (rank(mode) > rank(limit)) {
      mode = limit;
      cappedBy ??= why;
    }
  };
  if (!ceilings.memoryEnabled) cap('disabled', 'memoryDisabled');
  if (ceilings.customerData && !ceilings.customerCaptureEnabled) cap('readOnly', 'customerCaptureDisabled');
  if (!ceilings.categoryExtractionEligible) cap('manual', 'categoryNotExtractable');
  if (ceilings.sensitive) cap('approvalRequired', 'sensitive');
  if (ceilings.categoryRequiresApproval) cap('approvalRequired', 'categoryRequiresApproval');
  return { mode, from, cappedBy };
}

export const canRetrieve = (mode: MemoryMode) => mode !== 'disabled';
export const canExtract = (mode: MemoryMode) => rank(mode) >= rank('approvalRequired');
export const canCreateManually = (mode: MemoryMode) => rank(mode) >= rank('manual');

// What happens to an extracted candidate that passed validation, by the effective mode
export function candidateDecision(
  mode: MemoryMode,
  c: { confidence: number; importance: number; sensitivity: Sensitivity; hasConflict: boolean; isDuplicate: boolean; operation: CandidateOperation },
  s: Pick<ExtractionSettings, 'minConfidence' | 'minImportance' | 'autoApproveConfidence' | 'hybridMaxImportance'>
): 'discard' | 'queue' | 'autoSave' {
  if (!canExtract(mode)) return 'discard';
  if (c.sensitivity === 'secret') return 'discard';
  if (c.confidence < s.minConfidence || c.importance < s.minImportance) return 'discard';
  if (c.isDuplicate && c.operation === 'add') return 'discard';
  if (mode === 'approvalRequired' || c.hasConflict || c.sensitivity === 'personal' || c.operation !== 'add') return 'queue';
  if (mode === 'automatic') return c.confidence >= s.autoApproveConfidence ? 'autoSave' : 'queue';
  // hybrid: low-risk only
  return c.confidence >= s.autoApproveConfidence && c.importance <= s.hybridMaxImportance ? 'autoSave' : 'queue';
}

// ---- Settings ----

export type RankingWeights = { semantic: number; importance: number; recency: number; confidence: number };
export const DEFAULT_WEIGHTS: RankingWeights = { semantic: 0.5, importance: 0.25, recency: 0.15, confidence: 0.1 };

export type RetrievalParams = {
  weights: RankingWeights;
  minSimilarity: number;
  maxMemories: number;
  maxContextTokens: number;
  maxPerCategory: number;
  recencyHalfLifeDays: number;
  keywordBlend: number;
  pinnedBoost: number;
};

export const DEFAULT_RETRIEVAL: RetrievalParams = {
  weights: DEFAULT_WEIGHTS,
  minSimilarity: 0.3,
  maxMemories: 10,
  maxContextTokens: 2048,
  maxPerCategory: 4,
  recencyHalfLifeDays: 90,
  keywordBlend: 0.3,
  pinnedBoost: 0.1,
};

export type ExtractionSettings = {
  minConfidence: number;
  minImportance: number;
  autoApproveConfidence: number;
  hybridMaxImportance: number;
  maxPerConversation: number;
  maxPerDay: number;
  allowUpdateProposals: boolean;
  allowDeleteProposals: boolean;
  trigger: 'turn' | 'messages' | 'conversationEnd' | 'explicit' | 'scheduled';
  everyMessages: number;
  duplicateSimilarity: number;
  conflictSimilarity: number;
  paused: boolean;
};

export const DEFAULT_EXTRACTION: ExtractionSettings = {
  minConfidence: 0.6,
  minImportance: 3,
  autoApproveConfidence: 0.9,
  hybridMaxImportance: 5,
  maxPerConversation: 10,
  maxPerDay: 200,
  allowUpdateProposals: true,
  allowDeleteProposals: false,
  trigger: 'turn',
  everyMessages: 4,
  duplicateSimilarity: 0.9,
  conflictSimilarity: 0.75,
  paused: false,
};

export const INTELLIGENCE_PROVIDERS = ['mem0', 'native'] as const;
export type IntelligenceProviderId = (typeof INTELLIGENCE_PROVIDERS)[number];

export type ProviderSettings = {
  intelligence: IntelligenceProviderId;
  fallbackToNative: boolean;
  embeddingProvider: 'ollama' | 'openai';
  embeddingModel: string;
  extractionModel: string;
  conflictModel: string;
  summarizationModel: string;
  frontierModel: string;
  allowFrontierFallback: boolean;
  allowExternalPrivateContent: boolean;
  monthlyFrontierBudgetUsd: number;
};

export const DEFAULT_PROVIDERS: ProviderSettings = {
  intelligence: 'mem0',
  fallbackToNative: true,
  embeddingProvider: 'ollama',
  embeddingModel: 'qwen3-embedding:0.6b',
  extractionModel: 'qwen3:8b',
  conflictModel: 'gpt-oss:20b',
  summarizationModel: 'qwen3:8b',
  frontierModel: 'gpt-4o-mini',
  allowFrontierFallback: false,
  allowExternalPrivateContent: false,
  monthlyFrontierBudgetUsd: 5,
};

export type SystemSettings = {
  enabled: boolean;
  defaultMode: MemoryMode;
  defaultNamespace: string;
  customerCaptureEnabled: boolean;
  autoConflictResolution: boolean;
  autoFineTuning: boolean;
  sensitivePolicy: 'flagAndReview' | 'reject';
  syncIntervalMinutes: number;
  jobConcurrency: number;
  jobMaxAttempts: number;
  deletedRetentionDays: number;
  logLevel: 'quiet' | 'normal' | 'verbose';
  activeProfileId: string | null;
};

export const DEFAULT_SYSTEM: SystemSettings = {
  enabled: true,
  defaultMode: 'approvalRequired',
  defaultNamespace: 'personal',
  customerCaptureEnabled: false,
  autoConflictResolution: false,
  autoFineTuning: false,
  sensitivePolicy: 'flagAndReview',
  syncIntervalMinutes: 15,
  jobConcurrency: 2,
  jobMaxAttempts: 5,
  deletedRetentionDays: 30,
  logLevel: 'normal',
  activeProfileId: null,
};

export type MemoryConfig = { system: SystemSettings; extraction: ExtractionSettings; retrieval: RetrievalParams; providers: ProviderSettings };
export const DEFAULT_CONFIG: MemoryConfig = { system: DEFAULT_SYSTEM, extraction: DEFAULT_EXTRACTION, retrieval: DEFAULT_RETRIEVAL, providers: DEFAULT_PROVIDERS };

// Which settings take effect only after something else happens (shown beside them in System Settings)
export const SETTING_EFFECTS: Record<string, 'reembed' | 'restart' | 'approval' | null> = {
  'providers.embeddingModel': 'reembed',
  'providers.embeddingProvider': 'reembed',
  'system.jobConcurrency': 'restart',
  'system.syncIntervalMinutes': 'restart',
  'system.customerCaptureEnabled': 'approval',
  'providers.allowExternalPrivateContent': 'approval',
};

const num = (v: unknown, min: number, max: number, fallback: number) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback: T): T => (typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : fallback);
const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/;
const model = (v: unknown, fallback: string) => (typeof v === 'string' && MODEL_NAME.test(v) ? v : fallback);

// The weights as shares of 1 (all zero is the defaults), so a slider moved past the others never breaks ranking
export function normalizeWeights(w: Partial<RankingWeights> | null | undefined): RankingWeights {
  const raw = {
    semantic: num(w?.semantic, 0, 100, DEFAULT_WEIGHTS.semantic),
    importance: num(w?.importance, 0, 100, DEFAULT_WEIGHTS.importance),
    recency: num(w?.recency, 0, 100, DEFAULT_WEIGHTS.recency),
    confidence: num(w?.confidence, 0, 100, DEFAULT_WEIGHTS.confidence),
  };
  const sum = raw.semantic + raw.importance + raw.recency + raw.confidence;
  if (sum <= 0) return { ...DEFAULT_WEIGHTS };
  return { semantic: raw.semantic / sum, importance: raw.importance / sum, recency: raw.recency / sum, confidence: raw.confidence / sum };
}

export function parseRetrieval(v: unknown): RetrievalParams {
  const r = (v ?? {}) as Partial<RetrievalParams>;
  const d = DEFAULT_RETRIEVAL;
  return {
    weights: normalizeWeights(r.weights),
    minSimilarity: num(r.minSimilarity, 0, 1, d.minSimilarity),
    maxMemories: Math.round(num(r.maxMemories, 1, 50, d.maxMemories)),
    maxContextTokens: Math.round(num(r.maxContextTokens, 64, 16_384, d.maxContextTokens)),
    maxPerCategory: Math.round(num(r.maxPerCategory, 1, 50, d.maxPerCategory)),
    recencyHalfLifeDays: num(r.recencyHalfLifeDays, 1, 3650, d.recencyHalfLifeDays),
    keywordBlend: num(r.keywordBlend, 0, 1, d.keywordBlend),
    pinnedBoost: num(r.pinnedBoost, 0, 0.5, d.pinnedBoost),
  };
}

export function parseConfig(v: unknown): MemoryConfig {
  const c = (v ?? {}) as Partial<{ system: Partial<SystemSettings>; extraction: Partial<ExtractionSettings>; retrieval: unknown; providers: Partial<ProviderSettings> }>;
  const s = c.system ?? {};
  const e = c.extraction ?? {};
  const p = c.providers ?? {};
  const ds = DEFAULT_SYSTEM;
  const de = DEFAULT_EXTRACTION;
  const dp = DEFAULT_PROVIDERS;
  return {
    system: {
      enabled: bool(s.enabled, ds.enabled),
      defaultMode: oneOf(s.defaultMode, MEMORY_MODES, ds.defaultMode),
      defaultNamespace: typeof s.defaultNamespace === 'string' && NAMESPACE_PATH.test(s.defaultNamespace) ? s.defaultNamespace : ds.defaultNamespace,
      customerCaptureEnabled: bool(s.customerCaptureEnabled, ds.customerCaptureEnabled),
      autoConflictResolution: bool(s.autoConflictResolution, ds.autoConflictResolution),
      autoFineTuning: false, // never automatic (docs/AI_MEMORY_ARCHITECTURE.md, Fine-tuning)
      sensitivePolicy: oneOf(s.sensitivePolicy, ['flagAndReview', 'reject'] as const, ds.sensitivePolicy),
      syncIntervalMinutes: Math.round(num(s.syncIntervalMinutes, 1, 1440, ds.syncIntervalMinutes)),
      jobConcurrency: Math.round(num(s.jobConcurrency, 1, 8, ds.jobConcurrency)),
      jobMaxAttempts: Math.round(num(s.jobMaxAttempts, 1, 20, ds.jobMaxAttempts)),
      deletedRetentionDays: Math.round(num(s.deletedRetentionDays, 0, 365, ds.deletedRetentionDays)),
      logLevel: oneOf(s.logLevel, ['quiet', 'normal', 'verbose'] as const, ds.logLevel),
      activeProfileId: typeof s.activeProfileId === 'string' && /^[0-9a-f-]{36}$/.test(s.activeProfileId) ? s.activeProfileId : null,
    },
    extraction: {
      minConfidence: num(e.minConfidence, 0, 1, de.minConfidence),
      minImportance: Math.round(num(e.minImportance, 1, 10, de.minImportance)),
      autoApproveConfidence: num(e.autoApproveConfidence, 0, 1, de.autoApproveConfidence),
      hybridMaxImportance: Math.round(num(e.hybridMaxImportance, 1, 10, de.hybridMaxImportance)),
      maxPerConversation: Math.round(num(e.maxPerConversation, 0, 100, de.maxPerConversation)),
      maxPerDay: Math.round(num(e.maxPerDay, 0, 10_000, de.maxPerDay)),
      allowUpdateProposals: bool(e.allowUpdateProposals, de.allowUpdateProposals),
      allowDeleteProposals: bool(e.allowDeleteProposals, de.allowDeleteProposals),
      trigger: oneOf(e.trigger, ['turn', 'messages', 'conversationEnd', 'explicit', 'scheduled'] as const, de.trigger),
      everyMessages: Math.round(num(e.everyMessages, 1, 100, de.everyMessages)),
      duplicateSimilarity: num(e.duplicateSimilarity, 0.5, 1, de.duplicateSimilarity),
      conflictSimilarity: num(e.conflictSimilarity, 0.3, 1, de.conflictSimilarity),
      paused: bool(e.paused, de.paused),
    },
    retrieval: parseRetrieval(c.retrieval),
    providers: {
      intelligence: oneOf(p.intelligence, INTELLIGENCE_PROVIDERS, dp.intelligence),
      fallbackToNative: bool(p.fallbackToNative, dp.fallbackToNative),
      embeddingProvider: oneOf(p.embeddingProvider, ['ollama', 'openai'] as const, dp.embeddingProvider),
      embeddingModel: model(p.embeddingModel, dp.embeddingModel),
      extractionModel: model(p.extractionModel, dp.extractionModel),
      conflictModel: model(p.conflictModel, dp.conflictModel),
      summarizationModel: model(p.summarizationModel, dp.summarizationModel),
      frontierModel: model(p.frontierModel, dp.frontierModel),
      allowFrontierFallback: bool(p.allowFrontierFallback, dp.allowFrontierFallback),
      allowExternalPrivateContent: bool(p.allowExternalPrivateContent, dp.allowExternalPrivateContent),
      monthlyFrontierBudgetUsd: num(p.monthlyFrontierBudgetUsd, 0, 1000, dp.monthlyFrontierBudgetUsd),
    },
  };
}

// ---- Content ----

export const LIMITS = { title: 200, content: 4000, summary: 1000, reason: 500, metadataBytes: 8192, evidence: 2000, query: 2000 } as const;

// Whitespace and case don't make a different memory
export function normalizeContent(text: string): string {
  return text.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}

export function titleFrom(content: string): string {
  const first = content.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s/)[0];
  return first.length <= 80 ? first : `${first.slice(0, 77).trimEnd()}...`;
}

// About 4 characters a token for English; a little over, so budgets are never exceeded
export const estimateTokens = (text: string): number => Math.ceil(text.length / 3.6);

// ---- Sensitive content ----

export type Sensitivity = 'none' | 'personal' | 'secret';

// Secrets are never stored, whatever the mode (docs/AI_MEMORY_SECURITY.md); personal data is flagged and reviewed
const SECRET_PATTERNS: [string, RegExp][] = [
  ['privateKey', /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/],
  ['openaiKey', /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}/],
  ['awsKey', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['githubToken', /\bgh[pousr]_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}/],
  ['slackToken', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['stripeKey', /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}/],
  ['googleKey', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['jwt', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ['bearer', /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/i],
  ['connectionString', /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:[^\s@/]{3,}@/i],
  ['password', /\b(?:password|passwd|pwd|passcode|secret|api[_ -]?key|access[_ -]?token|auth[_ -]?token|client[_ -]?secret)\b\s*(?:is|=|:)\s*\S{4,}/i],
  ['cookie', /\b(?:session|sid|auth|token)[a-z_-]*=[A-Za-z0-9%._-]{20,}/i],
];

function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

// Long random-looking tokens (a key nobody labelled): 32+ characters of mixed letters and digits with high entropy
function highEntropyToken(text: string): boolean {
  for (const token of text.match(/[A-Za-z0-9_\-+/=]{32,}/g) ?? []) {
    if (!/[0-9]/.test(token) || !/[a-z]/.test(token) || !/[A-Z]/.test(token)) continue;
    const counts = new Map<string, number>();
    for (const ch of token) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    let h = 0;
    for (const c of counts.values()) h -= (c / token.length) * Math.log2(c / token.length);
    if (h > 4.2) return true;
  }
  return false;
}

export function detectSensitive(text: string): { sensitivity: Sensitivity; kinds: string[] } {
  const kinds: string[] = [];
  for (const [kind, pattern] of SECRET_PATTERNS) if (pattern.test(text)) kinds.push(kind);
  for (const match of text.match(/\b(?:\d[ -]?){13,19}\b/g) ?? []) {
    const digits = match.replace(/\D/g, '');
    if (digits.length >= 13 && digits.length <= 19 && luhn(digits)) kinds.push('paymentCard');
  }
  if (!kinds.length && highEntropyToken(text)) kinds.push('highEntropyToken');
  if (kinds.length) return { sensitivity: 'secret', kinds };
  const personal: string[] = [];
  if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(text)) personal.push('email');
  if (/(?:\+\d{1,3}[ .-]?)?\(?\d{3}\)?[ .-]?\d{3}[ .-]?\d{4}\b/.test(text)) personal.push('phone');
  if (/\b\d{3}-\d{2}-\d{4}\b/.test(text)) personal.push('nationalId');
  if (/\b(?:diagnos(?:ed|is)|medication|prescri(?:bed|ption)|religio(?:n|us)|sexual orientation|ethnicit(?:y|ies))\b/i.test(text)) personal.push('specialCategory');
  return personal.length ? { sensitivity: 'personal', kinds: personal } : { sensitivity: 'none', kinds: [] };
}

// What's left of a text once secrets are taken out, for logs and evidence that must never hold them
export function redactSecrets(text: string): string {
  let out = text;
  for (const [, pattern] of SECRET_PATTERNS) out = out.replace(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`), '[redacted]');
  return out.replace(/\b(?:\d[ -]?){13,19}\b/g, (m) => (luhn(m.replace(/\D/g, '')) ? '[redacted]' : m));
}

// ---- Prompt injection ----

// Text in memories and conversations is data. These phrases try to make it act as an instruction to the model or
// to the memory system; a candidate holding one is never auto-saved and is labelled for the reviewer.
const INJECTION = [
  /\bignore (?:all |any )?(?:the )?(?:previous|prior|above|earlier) (?:instructions|prompts?|rules)\b/i,
  /\b(?:system|developer) (?:prompt|message|instructions?)\b/i,
  /\byou are now\b|\bact as (?:an? )?(?:admin|administrator|system|developer)\b/i,
  /\b(?:disable|turn off|bypass|override) (?:the )?(?:memory )?(?:policy|policies|approval|safety|filter|guard|restrictions?)\b/i,
  /\b(?:always|never) (?:approve|auto-?approve|store|save|remember|delete) (?:this|these|all|every)\b/i,
  /<\/?(?:system|memory_context|instructions?)>/i,
];

export function looksLikeInjection(text: string): boolean {
  return INJECTION.some((p) => p.test(text));
}

// ---- Candidates ----

export const CANDIDATE_OPERATIONS = ['add', 'update', 'merge', 'delete', 'none'] as const;
export type CandidateOperation = (typeof CANDIDATE_OPERATIONS)[number];

export type RawCandidate = {
  title?: unknown;
  content?: unknown;
  category?: unknown;
  namespace?: unknown;
  confidence?: unknown;
  importance?: unknown;
  evidence?: unknown;
  expiresInDays?: unknown;
  operation?: unknown;
  targetMemoryId?: unknown;
  rationale?: unknown;
  speaker?: unknown;
};

export type ValidCandidate = {
  title: string;
  content: string;
  categoryKey: string;
  namespacePath: string | null;
  confidence: number;
  importance: number;
  evidence: string;
  expiresInDays: number | null;
  operation: CandidateOperation;
  targetMemoryId: string | null;
  rationale: string;
  speaker: 'user' | 'assistant' | 'unknown';
  sensitivity: Sensitivity;
  sensitiveKinds: string[];
  injection: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

// Every model answer is checked here before anything is done with it (docs/AI_MEMORY_ARCHITECTURE.md, Extraction):
// unknown categories become semantic, numbers are clamped, and what the assistant said (not the user) loses
// confidence, as an answer isn't a verified fact. Secrets come back with their content replaced, never stored.
export function validateCandidate(raw: RawCandidate, categories: readonly string[]): { ok: true; candidate: ValidCandidate } | { ok: false; reason: string } {
  const content = typeof raw.content === 'string' ? raw.content.replace(/\s+/g, ' ').trim() : '';
  if (content.length < 8) return { ok: false, reason: 'tooShort' };
  if (content.length > LIMITS.content) return { ok: false, reason: 'tooLong' };
  const operation = oneOf(raw.operation, CANDIDATE_OPERATIONS, 'add');
  if (operation === 'none') return { ok: false, reason: 'noOperation' };
  const speaker = oneOf(raw.speaker, ['user', 'assistant', 'unknown'] as const, 'unknown');
  let confidence = num(raw.confidence, 0, 1, 0.5);
  if (speaker === 'assistant') confidence = Math.min(confidence, 0.6);
  const evidence = typeof raw.evidence === 'string' ? raw.evidence.slice(0, LIMITS.evidence) : '';
  const sensitive = detectSensitive(`${content}\n${typeof raw.title === 'string' ? raw.title : ''}`);
  const secret = sensitive.sensitivity === 'secret';
  const injection = looksLikeInjection(content);
  const categoryKey = typeof raw.category === 'string' && categories.includes(raw.category.toLowerCase()) ? raw.category.toLowerCase() : 'semantic';
  return {
    ok: true,
    candidate: {
      title: secret ? '[redacted]' : typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim().slice(0, LIMITS.title) : titleFrom(content),
      content: secret ? '[redacted: contained a secret]' : content,
      categoryKey,
      namespacePath: typeof raw.namespace === 'string' && NAMESPACE_PATH.test(raw.namespace) ? raw.namespace : null,
      confidence: injection ? Math.min(confidence, 0.3) : confidence,
      importance: Math.round(num(raw.importance, 1, 10, 5)),
      evidence: secret ? '' : redactSecrets(evidence),
      expiresInDays: raw.expiresInDays === null || raw.expiresInDays === undefined ? null : Math.round(num(raw.expiresInDays, 1, 3650, 30)),
      operation,
      targetMemoryId: isUuid(raw.targetMemoryId) ? raw.targetMemoryId : null,
      rationale: typeof raw.rationale === 'string' ? redactSecrets(raw.rationale).slice(0, LIMITS.reason) : '',
      speaker,
      sensitivity: sensitive.sensitivity,
      sensitiveKinds: sensitive.kinds,
      injection,
    },
  };
}

// ---- Relationships ----

export const RELATIONSHIP_TYPES = ['relatedTo', 'dependsOn', 'supersedes', 'contradicts', 'supports', 'derivedFrom', 'belongsToProject', 'previousVersion', 'associatedDecision'] as const;
export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

// ---- Conflicts ----

export const CONFLICT_RESOLUTIONS = ['keepExisting', 'replace', 'merge', 'keepBoth', 'supersede', 'reject', 'defer'] as const;
export type ConflictResolution = (typeof CONFLICT_RESOLUTIONS)[number];

// Similarity alone is never a contradiction (docs/AI_MEMORY_ARCHITECTURE.md, Conflicts): a pair is a conflict only
// when a model or rule says so; this only decides which pairs are worth asking about
export function conflictCandidatePairs<T extends { id: string; similarity: number }>(similar: readonly T[], s: Pick<ExtractionSettings, 'conflictSimilarity' | 'duplicateSimilarity'>): { duplicates: T[]; check: T[] } {
  return {
    duplicates: similar.filter((m) => m.similarity >= s.duplicateSimilarity),
    check: similar.filter((m) => m.similarity >= s.conflictSimilarity && m.similarity < s.duplicateSimilarity),
  };
}

// Statements of the same subject that differ in a value: "X is hosted on Render" vs "X is hosted on Fly". A cheap
// pre-check that needs a model's confirmation; it never resolves anything on its own.
export function looksContradictory(a: string, b: string): boolean {
  const na = normalizeContent(a);
  const nb = normalizeContent(b);
  if (na === nb) return false;
  const neg = (s: string) => /\b(?:not|no longer|never|isn't|doesn't|don't|stopped|moved away from|replaced)\b/.test(s);
  if (neg(na) !== neg(nb)) return true;
  const wa = new Set(na.split(/\W+/).filter((w) => w.length > 2));
  const wb = new Set(nb.split(/\W+/).filter((w) => w.length > 2));
  const shared = [...wa].filter((w) => wb.has(w)).length;
  const onlyA = [...wa].filter((w) => !wb.has(w)).length;
  const onlyB = [...wb].filter((w) => !wa.has(w)).length;
  // Mostly the same words with a small different tail: a changed value
  return shared >= 2 && shared >= Math.max(onlyA, onlyB) && onlyA >= 1 && onlyB >= 1 && onlyA <= 3 && onlyB <= 3;
}
