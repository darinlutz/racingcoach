# Clarivex Memory Service: architecture

A centralized AI memory service inside RacingCoach, built to be reused by future Clarivex applications. PostgreSQL is the only authoritative store; Mem0 and the models only *propose*. Managed from AI Lab > **Memory Manager** (Admins only).

Related: [setup](AI_MEMORY_SETUP.md) · [API](AI_MEMORY_API.md) · [Open WebUI](AI_MEMORY_OPEN_WEBUI.md) · [security and per-user memory](AI_MEMORY_SECURITY.md) · [operations](AI_MEMORY_OPERATIONS.md) · [evaluation](AI_MEMORY_EVALUATION.md)

## Components

```text
Open WebUI (Mac)      RacingCoach features      Future apps
  filter function       userMemory.ts helpers     API key
        \                     |                    /
         +---------- Memory API /api/memory/v1 ---+        Render (web service)
                     auth: Admin session or cmk_ key
                     namespaces: resolveNamespaces + owner check
                              |
        +---------------------+----------------------+
        |                                            |
  Retrieval engine                            Job worker (Postgres queue)
  pgvector HNSW + full text                   extract · embed · reembed · sync
  ranking.ts (rank-v1)                        reconcile · cleanup · import
        |                                            |
        +------------ PostgreSQL ai_memory ----------+   authoritative
                              |  outbox
                 signed gateway + Cloudflare tunnel
                              |
        Mac: Ollama (embeddings, extraction, conflicts)  ·  Mem0 sidecar (Qdrant index)
```

| Piece | Where | Code |
|---|---|---|
| Rules (pure) | anywhere | `src/lib/memory/rules.ts`, `ranking.ts`, `portable.ts` |
| Schema | Postgres, schema `ai_memory` | `src/lib/memory/schema.ts` |
| Store, history, outbox, audit | Render | `src/lib/memory/store.ts` |
| Retrieval | Render | `src/lib/memory/retrieval.ts` |
| Intelligence providers | Render → Mac | `src/lib/memory/intelligence.ts` |
| Extraction pipeline | job worker | `src/lib/memory/extraction.ts` |
| Decisions (approval, conflicts) | Render | `src/lib/memory/decisions.ts` |
| Jobs | Render (live server) | `src/lib/memory/jobs.ts`, started by `src/instrumentation.ts` |
| API | Render | `src/app/api/memory/v1/**`, `src/lib/memory/api.ts` |
| Per-user helpers | Render | `src/lib/memory/userMemory.ts` |
| Gateway routes | Mac | `local-ai/memoryRoutes.ts` (under `/lab/`, same signature) |
| Mem0 sidecar | Mac | `local-ai/mem0/server.py` |
| Open WebUI filter | Mac | `local-ai/openwebui/clarivex_memory_filter.py` |
| Memory Manager UI | browser | `src/components/aiLab/memory/` |

## Why this shape

- **Mem0 is not on Render.** mem0ai 2.2.1's REST server only accepts OpenAI, Anthropic or Gemini; running it there would send private memory text to a frontier provider, which the default policy forbids. The sidecar uses the Mem0 *library* against local Ollama, reached through the existing signed gateway, so nothing new is exposed and Render needs no new service.
- **The job worker runs in the web service.** Jobs are rows in Postgres claimed with `FOR UPDATE SKIP LOCKED`, so they're durable and safe with several instances; no separate Render worker is needed. Long work (extraction) never runs inside a request: `/extract` answers 202.
- **Normal RacingCoach doesn't depend on the Mac.** When Ollama is offline, retrieval falls back to keyword search over approved memories and extraction is deferred; when Mem0 is offline, the native provider takes over.

## Database (`ai_memory` schema)

| Table | Purpose |
|---|---|
| `Memories` | authoritative records; status, flags, version, content hash, generated `search_tsv` |
| `MemoryEmbeddings` | `REAL[]` vectors per model, size, embedding version and memory version |
| `MemoryHistory` | a snapshot per version, who/what changed it and why |
| `MemoryCategories`, `MemoryNamespaces` | configurable classifications; hierarchical namespaces, including users' own spaces |
| `MemoryCandidates` | everything extraction proposed (Pending, Approved, Rejected, Merged, Discarded) |
| `MemoryConflicts`, `MemoryRelationships` | contradictions for review; typed relationships (graph) |
| `MemorySettings`, `MemoryRetrievalProfiles` | settings (global, application, user, service state); named ranking profiles |
| `MemoryAccessLog`, `MemoryFeedback` | retrievals (query **hash**, never text); feedback |
| `MemoryJobs` | the durable queue (the spec's "extraction jobs" and every other job) |
| `MemoryProviderSync`, `MemoryProviderRecords` | the outbox to Mem0, and which Mem0 IDs hold each memory |
| `MemoryDeletions` | tombstones (ID and content hash only) so nothing deleted comes back |
| `MemoryApiClients`, `MemoryAuditLog` | API keys (hashed) and the audit trail |
| `MemoryEvaluationCases`, `MemoryEvaluationRuns`, `MemoryExports` | evaluation; exports and datasets (72 h, owner only) |

Constraints worth knowing: `is_active` only with status Active (`memories_active_status`); `deleted_at` exactly when Deleted; one live memory per text per namespace (`memories_unique_content`); importance 1–10, confidence 0–1; a user-owned namespace is always customer data (`namespaces_owned_customer`); a trigger sets a memory's `user_id` to its namespace's owner.

### Embeddings and pgvector

Embeddings are stored as `REAL[]`, the source of truth. With pgvector (0.8.1 locally, Render Postgres 18 offers it), each model gets a **partial HNSW expression index**:

```sql
CREATE INDEX memory_embeddings_hnsw_<hash> ON ai_memory."MemoryEmbeddings"
  USING hnsw ((embedding::vector(1024)) vector_cosine_ops)
  WHERE model = 'qwen3-embedding:0.6b' AND dimensions = 1024 AND indexing_status = 'ready';
```

Retrieval orders by the same expression (`SET LOCAL hnsw.iterative_scan = relaxed_order` so the namespace filter doesn't starve results). Models of different sizes live side by side, and a new model's index is built before retrieval switches to it ([operations](AI_MEMORY_OPERATIONS.md#embedding-migration)). Without pgvector, cosine runs in memory over up to 5,000 embeddings. Only embeddings of the same model, size, embedding version and the memory's current version are ever compared.

**Embedding model: `qwen3-embedding:0.6b` (1024 dims).** Already installed and used by Open WebUI's knowledge search; measured here at ~50 ms per query on the M-series Mac, similarity 0.86 for "What is RacingCoach?" against the matching memory, and it caught a reworded duplicate in the live acceptance run. Nomic Embed Text (768 dims) isn't installed; Qwen3-Embedding-0.6B scores higher on the public MTEB leaderboards and is multilingual (the site serves six languages). 1024 dims is under HNSW's 2,000 limit.

### Storage estimates

Design figures (Analytics shows measured ones once there are 50 memories): ~2.5 KB per memory row with history and indexes, ~4.2 KB per 1024-dim embedding, ~4.3 KB of HNSW per vector — about **11 KB per memory**.

| Memories | Estimate |
|---|---|
| 10,000 | ~110 MB |
| 100,000 | ~1.1 GB |
| 1,000,000 | ~11 GB |

The production database is plan 0.5c-1g. Up to ~100k memories fits comfortably in the shared database. Move `ai_memory` to its own Render Postgres when it passes ~500k memories, when the HNSW index no longer fits in memory (watch index size vs RAM), or before customer capture goes to many users. The schema is self-contained, so moving it is a `pg_dump -n ai_memory` and a connection string.

## Lifecycle

Statuses: **Pending → Approved/Active → Archived / Superseded / Expired → Deleted**, plus Rejected. Allowed transitions are `STATUS_TRANSITIONS` in `rules.ts`; a Deleted memory never comes back. Only Active memories with retrieval on and not past `expires_at` are ever retrieved.

Every change is one transaction: the row, a history snapshot, an embed job when the text changed (old embeddings marked stale), and an outbox entry for Mem0. Updates carry the version the caller saw; a stale one is refused (409), never overwritten.

## Extraction

```text
message/turn → /extract (202) → job → eligibility (mode, pause, daily cap)
→ provider candidates (Mem0, else native) → validateCandidate (clamp, category, secrets, injection, speaker)
→ duplicates (exact hash + embeddings ≥ 0.90) → conflicts (rule pre-check + model confirmation)
→ effective mode per category → Discarded | Pending (queue) | Active (auto-save) → embed → outbox
```

- Secrets are redacted from the conversation before any model sees it, and a candidate holding one is stored only as `[redacted]`.
- What only the assistant said gets confidence ≤ 0.6 and is never auto-saved.
- Text that looks like an instruction to the AI or the memory system is flagged and never auto-saved.
- **Measured Mem0 behaviour** (mem0ai 2.2.1, qwen3:8b): extraction is ADD-only, returns nothing when the conversation ends on an assistant turn (the sidecar sends only user turns), and skips impersonal project facts. When Mem0 finds nothing, the native extractor reads the same turn.

### Operating modes and precedence

Disabled < Read Only < Manual < Approval Required < Hybrid < Automatic. The most specific layer that sets one wins (user → category → namespace → application → global default, Approval Required). Then ceilings no layer can lift: memory off → Disabled; customer data without customer capture → Read Only; a category not eligible for extraction → Manual; sensitive content or a category requiring approval → Approval Required (`effectiveMode` in `rules.ts`). Explicit deletion is always allowed.

## Retrieval

1. Authenticate; resolve the namespaces the caller may read (`resolveNamespaces`), then the SQL owner check.
2. Embed the query (falls back to keyword-only when Ollama is down: `degraded`).
3. Semantic candidates (HNSW) + keyword candidates (`ts_rank_cd` over OR-ed words) + pinned memories.
4. Rank (`ranking.ts`, version `rank-v1`): normalized factors — relevance (semantic, or a 70/30 blend with keyword in hybrid), importance `(i-1)/9`, recency `0.5^(age/half-life)` from max(updated, verified), confidence — combined with weights normalized to sum 1 (default 50/25/15/10). Pinned memories get +0.10 only when relevant.
5. Exclude expired, inactive, sensitive (unless an Admin asks), below the similarity threshold, duplicates; then per-category, memory-count (10) and token (2,048) limits.
6. Build the context block: a labelled `<memory_context>` that says it is reference data, not instructions; a memory can't close it early.
7. Record the retrieval (query hash only).

## Conflicts

Similarity alone is never a contradiction. Pairs between 0.75 and 0.90 similarity go through a rule pre-check (same subject, changed value or negation), then the conflict model (`gpt-oss:20b` by default) confirms with an explanation and recommendation. Locked memories refuse replace/merge/supersede until unlocked. Automatic conflict resolution is off.

## Fine-tuning preparation

Approved memories become JSONL (chat or instruction format) with provenance per example. Memories linked by relationships or supersede chains share a group (union-find), and a group goes wholly into one split, so related facts never leak between train and test. Sensitive and customer memories are excluded. Nothing is trained, and fine-tuning is never automatic. **Deleting a memory later does not remove what a fine-tuned model learned from it.**
