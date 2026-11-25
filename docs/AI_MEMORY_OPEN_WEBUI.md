# Clarivex Memory Service: Open WebUI

Open WebUI (v0.13.4 on the Mac) becomes a consumer of the central memory: a **Filter Function** retrieves approved memories before each request and queues extraction after each answer. It never writes Open WebUI's own memory and never decides what's approved. Filters were chosen over Pipelines (an extra service) and Tools (the model would decide when to remember): a filter runs on every chat, for every model, with no model cooperation.

File: `local-ai/openwebui/clarivex_memory_filter.py`.

## How it works

**Before the model (`inlet`)**: skips Open WebUI's own tasks (titles, tags, follow-ups); drops any earlier `<memory_context>` block (never injects twice); sends the last user message to `/retrieve` with your Open WebUI user ID as `X-Memory-Subject`; inserts the context as a separate system message just before your question, so the model's own system prompt stays first and unchanged. Timeout 4 s; on any failure the chat carries on without memory and the status line says "Memory unavailable".

**After the answer (`outlet`)**: every N user messages, sends the last few messages (without the memory block) to `/extract` with `Idempotency-Key: owui:<chat>:<message>`, so a re-run never queues twice. Returns at once; extraction happens on the server.

Because retrieval happens on the server and not in any model, **every Ollama model gets the same memory**, and switching models mid-chat changes nothing.

Valves (Admin): `api_url`, `api_key`, `retrieval_namespaces`, `default_namespace`, `include_children`, `extract`, `extract_every_messages`, `extract_window`, `timeout_seconds`, `show_status`. User valves: `enabled`, `namespace` (the server checks it), `extract`.

## Install

1. **Key**: Memory Manager > System Settings > API clients. Name `Open WebUI`, application `open-webui`, scopes `memory:read`, `memory:extract`, `memory:feedback`, namespaces (e.g. `personal`, `racingcoach`, `clarivex`, `ai-lab`), subjects = your Open WebUI user ID (Open WebUI > Settings > Account, or Admin Panel > Users). Copy the `cmk_…` key: it's shown once.
2. **Filter**: Open WebUI > Admin Panel > Functions > **+** > paste the file > Save. Turn it on, open its **⋯ > Global** so it runs for every model.
3. **Valves** (gear icon): `api_url` = `https://racingcoach.app/api/memory/v1` (or `http://host.docker.internal:3000/api/memory/v1` for a local dev server), `api_key` = the key, `retrieval_namespaces` = `personal,racingcoach,clarivex` (empty = everything the key may read), `default_namespace` = `personal`.
4. **Test retrieval** (acceptance test 2): Memory Manager > Library > New memory "RacingCoach is a sim racing AI coaching platform developed by Clarivex." in `racingcoach`. New Open WebUI chat: "What is RacingCoach?". The status line says "Memory: 1 used"; the answer uses the fact.
5. **Test across models** (test 3): switch the chat to another Ollama model and ask again: same memory.
6. **Test extraction** (test 4): tell it a new fact, e.g. "The RacingCoach Discord bot runs as a Render background worker." Within a minute it's in Memory Manager > Approval Queue, and it isn't retrieved until you approve it.

Verified against the real filter code and a local server on 2026-11-24 (qwen3:8b and gpt-oss:20b requests): injection, single injection on re-runs, unknown user refused, tasks skipped, idempotent extraction, candidate queued. Steps 2–6 inside your Open WebUI are yours to run.

## Migrating native memories

Native memory stays untouched until you've verified the migration.

1. Back up: `local-ai/openwebui/backup.sh`.
2. Memory Manager > Import and Export > **Open WebUI migration > Compare**: how many native memories are already in the central store.
3. **Preview native memories**: a dry run (new, duplicate, possible duplicate, previously deleted, contains a secret). Choose the default namespace and category, pick the rows, **Import**. Imported memories are Active, source `openWebuiMigration`, with the native ID in `sourceReference`.
4. **Ask both** with a few real questions: central and native results side by side.
5. When they agree, turn native memory off: Open WebUI > Settings > Personalization > **Memory** off (each user), and leave the Admin "Memories" feature off for new chats. The filter's status line warns while both are on ("Open WebUI's own memory is also on"), since the model would otherwise get two memory blocks.

**Rollback**: switch native memory back on (its data was never changed), turn the Clarivex Memory filter off, and if you want, delete the imported memories (Library filter by source application `open-webui` > select > Delete).

## Troubleshooting

| Status line | Cause |
|---|---|
| Memory unavailable (401) | wrong or revoked key |
| Memory unavailable (403) | your Open WebUI user ID isn't in the key's subjects, or a namespace the key may not read |
| Memory unavailable (timeout) | the site is slow or unreachable; raise `timeout_seconds` or check the site |
| Memory: 0 used (embeddingUnavailable…) | Ollama offline: keyword-only results |
| No status at all | the filter is off, not Global, or `api_key` doesn't start with `cmk_` |
