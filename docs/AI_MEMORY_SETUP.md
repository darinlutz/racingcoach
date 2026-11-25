# Clarivex Memory Service: setup

What's already in the repository, and what you set up by hand, in order. Nothing here needs a new public endpoint or a new Render service.

## What changes where

| Repository (deployed with the site) | You, by hand |
|---|---|
| `ai_memory` schema, created on first use | `CREATE EXTENSION vector` happens automatically; check it worked (Render step 2) |
| Memory API, Memory Manager, job worker | nothing: deploys with `main` |
| Gateway routes `/lab/memory/*`, `/lab/mem0/*` | pull the repo on the Mac and restart the gateway |
| Mem0 sidecar code | create its venv, `.env` and launchd job |
| Open WebUI filter code | paste it into Open WebUI, make an API key |

## Mac (MacBook Pro)

### 1. Check what's installed

```bash
ollama --version                                     # tested with 0.40.15
curl -s http://127.0.0.1:11434/api/tags | python3 -m json.tool | grep '"name"'
docker ps --format '{{.Names}} {{.Image}}' | grep open-webui   # tested with v0.13.4
curl -s http://127.0.0.1:8787/health                # the gateway answers (401 is fine: it's signed)
```

### 2. Back up Open WebUI and export its memories

```bash
cd ~/Desktop/Clarivex/racingcoach
local-ai/openwebui/backup.sh                         # the existing volume backup
```

Then in the Memory Manager: **Import and Export > Open WebUI migration > Compare** (reads them through the gateway, changes nothing). Keep the backup until the migration is verified.

### 3. Models

```bash
ollama pull qwen3-embedding:0.6b    # embeddings (1024 dims); already installed here
ollama pull qwen3:8b                # extraction and classification; already installed
ollama pull gpt-oss:20b             # conflict detection; already installed
```

### 4. Mem0 sidecar

```bash
cd ~/Desktop/Clarivex/racingcoach/local-ai/mem0
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt            # mem0ai 2.2.1, ollama 0.6.3, qdrant-client 1.20.0
cp .env.example .env                                  # defaults are right for this Mac
.venv/bin/python server.py                            # first run: Ctrl-C once it prints "Mem0 sidecar 2.2.1 on ..."
curl -s -XPOST http://127.0.0.1:8765/health -d '{}'   # {"ok": true, "version": "2.2.1", ...}
```

Start it at login:

```bash
REPO=~/Desktop/Clarivex/racingcoach
sed "s#REPO#$REPO#g" $REPO/local-ai/launchd/app.racingcoach.mem0.plist > ~/Library/LaunchAgents/app.racingcoach.mem0.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/app.racingcoach.mem0.plist
tail -f /tmp/racingcoach-mem0.log
```

### 5. Gateway

Add to `local-ai/.env` (the lab must already be on: `LOCAL_AI_LAB=on`):

```bash
MEM0_URL=http://127.0.0.1:8765
LOCAL_AI_MEMORY_MAX_CONCURRENCY=1
```

Restart: `launchctl kickstart -k gui/$(id -u)/app.racingcoach.local-ai`. AI Lab > Overview should still show the Mac online; Memory Manager > Providers shows Ollama and Mem0 green.

### 6. Open WebUI integration

Follow [AI_MEMORY_OPEN_WEBUI.md](AI_MEMORY_OPEN_WEBUI.md): create an API client key, paste the filter, set its valves, test, migrate, and only then turn native memory off.

### 7. Test

In the Memory Manager: Overview (all services green), Library > New memory ("RacingCoach is a sim racing AI coaching platform developed by Clarivex."), then Retrieval Inspector with "What is RacingCoach?". The repo's live check runs every model-backed acceptance test against a scratch database:

```bash
createdb -h 127.0.0.1 racingcoach_memory_live
MEMORY_LIVE_DATABASE_URL=postgres://127.0.0.1/racingcoach_memory_live MEMORY_OLLAMA_URL=http://127.0.0.1:11434 \
  MEMORY_MEM0_URL=http://127.0.0.1:8765 npm run memory:acceptance
```

### Logs and troubleshooting

| Symptom | Look at |
|---|---|
| Providers: Ollama red | `curl 127.0.0.1:11434/api/version`; gateway log `/tmp/racingcoach-local-ai.log` |
| Mem0 red, "mem0NotConfigured" | `MEM0_URL` missing in `local-ai/.env`; restart the gateway |
| Mem0 red, "mem0Unreachable" | `/tmp/racingcoach-mem0.log`; `launchctl print gui/$(id -u)/app.racingcoach.mem0` |
| Extraction jobs Deferred | the Mac is offline or busy (production slots full): they retry; Jobs shows why |
| "Paused after failures" | the circuit breaker; Providers > Reset circuit breakers after fixing the cause |
| Mem0 index looks wrong | stop the sidecar, delete `~/.racingcoach/mem0`, start it, then Jobs > Reconcile |

Rollback on the Mac: `launchctl bootout gui/$(id -u)/app.racingcoach.mem0`, remove `MEM0_URL`, restart the gateway. The site falls back to the native provider by itself.

## Render

Nothing new to create. The Memory Service runs in the existing web service, its jobs in the existing process, its data in the existing database.

1. **Deploy** `main` as usual (CI must pass; CI's database is `pgvector/pgvector:pg17` so the HNSW code is tested).
2. **pgvector**: the first memory request runs `CREATE EXTENSION IF NOT EXISTS vector`. Check: Memory Manager > Overview shows "pgvector 0.8.x". If it says not installed, connect with the database's admin credentials and run `CREATE EXTENSION vector;` (Render supports it on Postgres 18). Semantic search works without it (in memory) but slower past a few thousand memories.
3. **Environment variables**: none required. Existing ones it uses: `DATABASE_URL`, `LOCAL_AI_SHARED_SECRET`, `LOCAL_AI_CF_ACCESS_CLIENT_ID`/`SECRET` (to reach the Mac), `OPENAI_API_KEY` (only if you allow frontier fallback). Never set `MEMORY_OLLAMA_URL` or `MEMORY_MEM0_URL` on Render: they're for local development and ignored on the live server.
4. **Migrations**: none to run. `ensureMemorySchema` creates the schema, seeds 12 categories and the namespaces, and is additive only.
5. **Resources and cost**: no new Render cost. Expect a few MB of database per thousand memories (see the estimates in [architecture](AI_MEMORY_ARCHITECTURE.md#storage-estimates)); the worker polls every 5 s with one small query. Local models cost nothing; frontier fallback is off, and when on is capped by the monthly budget in Providers and counted in Admin > AI usage as `memoryProcessing`.
6. **Order**: deploy → open the Memory Manager once (creates the schema) → set up the Mac (above) → create the Open WebUI key.

## Cloudflare

**Reuse the existing tunnel and Access application** (`ai.racingcoach.app`). The memory routes are gateway paths under `/lab/`, signed with the same `lab` purpose, so the existing Access policy (service token for Render) already covers them. No DNS change, no new hostname, no new token.

Open WebUI reaches the Memory API at `https://racingcoach.app/api/memory/v1` over the public site (the API needs a `cmk_` key; without one it answers 404/401). It doesn't need Cloudflare Access.

Test from Render's shell or locally with the secret: Memory Manager > Providers > Test connection / Test embedding exercise the whole path (site → tunnel → Access → gateway → Ollama/Mem0).

## Environment variables

| Name | Where | Purpose |
|---|---|---|
| `MEM0_URL` | Mac `local-ai/.env` | the sidecar, e.g. `http://127.0.0.1:8765` |
| `LOCAL_AI_MEMORY_MAX_CONCURRENCY` | Mac `local-ai/.env` | memory model calls at once (default 1) |
| `MEM0_HOST`, `MEM0_PORT`, `OLLAMA_URL`, `MEM0_LLM_MODEL`, `MEM0_EMBED_MODEL`, `MEM0_EMBED_DIMS`, `MEM0_DATA_DIR` | Mac `local-ai/mem0/.env` | the sidecar |
| `MEMORY_OLLAMA_URL`, `MEMORY_MEM0_URL` | your dev `.env.local` only | talk to Ollama/Mem0 directly on this computer during development |
| `MEMORY_TEST_DATABASE_URL`, `MEMORY_LIVE_DATABASE_URL` | tests | local databases for `npm run test:memory` and `npm run memory:acceptance` |
