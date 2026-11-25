# Clarivex Memory Service: evaluation and tests

## Test suites

| Command | What | Needs |
|---|---|---|
| `npm run test:memory` | 46 pure tests (rules, modes, namespaces and per-user isolation, secrets, injection, ranking, context, import, metrics, datasets), then 17 database tests through the real store, jobs and API routes with real keys | `MEMORY_TEST_DATABASE_URL` for the second part (Postgres with pgvector; CI uses `pgvector/pgvector:pg17`) |
| `npm run memory:acceptance` | the model-backed acceptance tests with real Ollama, Mem0 and pgvector, no stand-ins | the Mac's models and the sidecar; `MEMORY_LIVE_DATABASE_URL`, `MEMORY_OLLAMA_URL`, `MEMORY_MEM0_URL` |

The database suite replaces Ollama with a deterministic bag-of-words embedder and Mem0 with a stand-in sidecar on 127.0.0.1, so it runs in CI.

## Proof-of-concept acceptance tests

| # | Test | Where | Result (2026-11-24) |
|---|---|---|---|
| 1 | Manual memory: stored, embedded, in the library, searchable, retrieved | db + live | pass (qwen3-embedding, 1024 dims, HNSW index, similarity 0.86) |
| 2 | Open WebUI retrieval | filter code against a local server | pass for the filter; **inside your Open WebUI: not run** (install is manual) |
| 3 | Cross-model memory | filter with qwen3:8b and gpt-oss:20b | pass for the filter; in Open WebUI: not run |
| 4 | Extraction → queue → not retrieved → approved → retrieved | db + live + HTTP | pass (Mem0, with native fallback) |
| 5 | Duplicate in other words | db + live | pass (live: caught by real embeddings) |
| 6 | Conflict proposed, not overwritten | db + live | pass (live: gpt-oss:20b explained Render vs Fly.io) |
| 7 | Locked memory unchanged under Automatic | db + live | pass |
| 8 | Namespace isolation (RacingCoach, TalkNinja, personal) | db, through the API with keys | pass |
| — | Per-user isolation (customer A vs B, Admin access, SQL owner check, Delete Account) | db, through the API | pass |
| 9 | Ranking weights change the order | db (inspector) | pass |
| 10 | Expiration | db | pass |
| 11 | Version history and restore, embeddings follow | db | pass |
| 12 | Permanent deletion: Postgres, Mem0, no resurrection | db + live | pass |
| 13 | Ollama offline: keyword retrieval, deferred extraction, then completes | db + live | pass |
| 14 | Mem0 offline: native provider | db + live | pass |
| 15 | Evaluation run with stored metrics | db | pass |
| 16 | Open WebUI migration | code path exercised (compare/preview/import); **with your native memories: not run** |
| 17 | Security: non-Admins, bad keys, other namespaces, secrets, injection, stale jobs | db + HTTP | pass (a non-Admin's session gets 404; verified on the dev server) |

## The Evaluation Lab

Memory Manager > Evaluation. A **case** is a prompt, the memory IDs that should come back, the ones that must not (e.g. another namespace's), an expected answer and the namespaces to search. A **run** retrieves for every case with a mode, profile and K, and optionally asks a local model to answer with the memory context and without it.

| Metric | Kind |
|---|---|
| Precision@K, Recall@K, MRR | deterministic, from expected IDs |
| Unauthorized rate | deterministic: share of retrieved memories that were listed as must-not-appear (should always be 0) |
| Utilization | deterministic: share of retrieved memories that were expected |
| Answer overlap (memory / no memory) | deterministic word overlap with the expected answer, **not** a judge |
| Tokens, latency | measured |

LLM-as-judge and human ratings aren't built; Retrieval Inspector feedback (Helpful, Not helpful, Incorrect, Outdated, Irrelevant, Missing context) is stored per memory and shown in Analytics > Quality. Every run is kept, so a change to ranking, models or profiles can be compared against earlier runs (regression).

Suggested regression dataset: one case per namespace that must not leak (TalkNinja questions from a RacingCoach key with the TalkNinja memory as must-not-appear), plus your ten most-asked questions with their expected memories.
