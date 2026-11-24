# AI Lab: Open WebUI, local models, memory, RAG and the playground

The AI Lab page (the nav bar's AI Lab link, `/model-learning`, Admins only) is an experimentation environment for open-weight models running on the owner's MacBook Pro: Open WebUI for conversations, memory, knowledge bases and model configurations; model management and a side-by-side playground against the frontier models; and a plan for fine-tuning with Apple MLX. It is **not** a production dependency: production AI routing is unchanged (docs/local-ai.md), and with the Mac off, asleep or unplugged, RacingCoach works exactly as before.

## Status

| Part | State |
|---|---|
| Gateway lab routes (`local-ai/lab.ts`), website routes, AI Lab tabs, database tables, docs | **Implemented** |
| Gateway routes against stand-ins for Ollama, Open WebUI and the registry (36 tests); rules and route guards; database (6 tests, real Postgres); browser (2 tests, production build) | **Tested** (`npm run test:ai-lab`, `e2e/ai-lab.spec.ts`) |
| Docker Compose, backup and restore scripts | Written and syntax-checked; **not run** (Docker isn't on the development machine) |
| Against a real Open WebUI 0.13.4 and a real Ollama | **Pending**: the Open WebUI routes were built from its source on GitHub (`routers/memories.py`, `knowledge.py`, `models.py`), not run against it. The proof of concept below is that test |
| Cloudflare hostname and Access policy, Mac setup | **Pending manual configuration** (below) |
| Fine-Tuning Lab | **Plan only** (Phase 4, below) |

## What the review of the repository found

- **AI Lab page** existed (`src/app/model-learning/page.tsx`) with the Local AI sections for Admins. They're now its **Production Routing** tab, unchanged.
- **Local AI** (docs/local-ai.md) already had what the lab needs: a gateway on the Mac (`local-ai/gateway.ts`) behind **Cloudflare Tunnel** (`ai.racingcoach.app`) and a **Cloudflare Access service token**, every request **HMAC-signed** (`src/lib/localAi/signing.ts`), heartbeats, a circuit breaker, cloud fallback, and `"AiInferenceEvents"` for every model call. The lab **reuses all of it**: no new tunnel for the website, no new Render secrets, no second connection path.
- **Authentication is RacingCoach's own** (sessions in `"Sessions"`, roles Admin/Coach/User in `src/lib/roles.ts`). **There is no Auth0** in this codebase, so there's no Auth0 RBAC to integrate. Every lab route checks the Admin role on the server and answers 404 to anyone else, like the Admin page. Open WebUI can't use RacingCoach's sign-in (RacingCoach isn't an OpenID provider), so it's protected by **Cloudflare Access** (your email) plus **its own admin account**.
- **Postgres**: no pgvector; the Race Engineering knowledge base computes cosine similarity in memory. The lab's knowledge bases are Open WebUI's own (its database and vector store on the Mac), kept apart from production RAG.
- **R2** isn't used by the lab: Open WebUI's files stay in its Docker volume on the Mac.

## Architecture

```
 Your browser ──https──▶ racingcoach.app (Render) ── AI Lab page, /api/admin/ai-lab/* (Admin role, server-side)
      │                         │
      │                         │ HTTPS + CF Access service token + HMAC signature (purpose "lab")
      │                         ▼
      │              https://ai.racingcoach.app ── Cloudflare Access (service token only)
      │                         │ cloudflared tunnel (outbound from the Mac; no open ports)
      │                         ▼
      │              127.0.0.1:8787  local-ai/gateway.ts
      │                 ├─ GET /health, POST /v1/chat/completions   (production, unchanged)
      │                 └─ /lab/*  (LOCAL_AI_LAB=on; fixed paths only)
      │                        ├──▶ 127.0.0.1:11434  Ollama (native, Apple Silicon GPU)
      │                        └──▶ 127.0.0.1:8080   Open WebUI API (with OPEN_WEBUI_API_KEY, kept on the Mac)
      │
      └──https──▶ https://ai-lab.racingcoach.app ── Cloudflare Access (your email, one-time PIN)
                                │ same cloudflared tunnel
                                ▼
                     127.0.0.1:8080  Open WebUI (Docker, its own admin login)
                                │ host.docker.internal:11434
                                ▼
                         Ollama (native)
```

**Recommendation on the proposed architecture:** it's right, with three adjustments, all made here. (1) **No second website-to-Mac channel**: the website reaches Open WebUI's API through the existing gateway, so the Open WebUI API key never leaves the Mac and Render needs nothing new. (2) **Open WebUI on port 8080, bound to 127.0.0.1** (its docs use 3000, which clashes with `npm run dev`). (3) **Not embedded** in the page (below). Ollama stays native and on 127.0.0.1. Docker Desktop for Mac forwards `host.docker.internal` to the Mac's loopback, so Ollama never needs `OLLAMA_HOST=0.0.0.0`, which some guides suggest and which would expose Ollama to your network.

### Why Open WebUI opens in its own tab

Open WebUI sends `X-Frame-Options: DENY` by default, and Cloudflare Access's sign-in page can't be shown in a frame. Embedding would mean switching Open WebUI to allow framing by racingcoach.app, adding `frame-src` to RacingCoach's CSP, and still breaking whenever Access asks you to sign in. That weakens clickjacking protection on both sides for a cosmetic gain, so **Launch Open WebUI** opens it in a new tab. All of Open WebUI's own features work there unchanged: conversations, history, model selection, system prompts, parameters, memory, knowledge, uploads, prompts, tools, response comparison (its "+" to add models to a chat) and export.

## What's on the page

| Tab | What it does | Where it comes from |
|---|---|---|
| Overview | Open WebUI, Ollama, gateway and production heartbeat status (green online, yellow degraded/starting, red offline, gray not configured); versions; loaded and available models; active requests (production and lab, with limits); 24-hour local vs frontier counts and average latency; lab cloud spend; last heartbeat, last success, last error, uptime, round trip; Test Connection, Refresh Status, Launch Open WebUI, the production Enabled switch; lab settings; audit log | `GET /api/admin/ai-lab/status` → gateway `GET /lab/status` (cached 5 s, failures 15 s), `"AiInferenceEvents"`, `"LocalAiServers"` |
| Open WebUI | Launch button, why not embedded, sign-in and license notes | lab settings |
| Models | Every Ollama model: family, parameters, quantization, size, modified date; loaded or not, with memory **reported** by Ollama (and GPU memory) for loaded models and an **estimate** (file size) for the rest; details (model's maximum context vs the context served, `num_ctx`, capabilities); Load / Unload / Test / Make default / per-model default parameters / Remove; Download with size check and typed confirmation, progress while it runs on the Mac | gateway `/lab/status`, `/lab/show`, `/lab/load`, `/lab/unload`, `/lab/remote-size`, `/lab/pull`, `/lab/pulls`, `/lab/delete` |
| Playground | Up to four models side by side (any installed local model, any cloud model in `AI_MODELS`); system and user prompt; temperature, top P, top K, context length, max output tokens, repeat penalty, seed (only those the provider takes are sent; others are listed "not offered"); streaming on/off; time to first token (on the server, and on the Mac for local), total time, input/output tokens, tokens/s, estimated cost, the model that actually answered, fallback (always none); save prompts and results | `POST /api/admin/ai-lab/playground` (NDJSON) → gateway `/lab/chat` or the cloud provider |
| Memory | Open WebUI's memories: list, search, add, edit, delete; Test retrieval (what Open WebUI's memory search returns for a question, then a local model asked with those memories in its system prompt); what memory is and isn't | gateway `/lab/webui/memories*` |
| Knowledge | Open WebUI's knowledge bases; create the seven suggested ones; embedding model recommendation | gateway `/lab/webui/knowledge` |
| Model Configurations | Open WebUI workspace models, labelled "configuration (base weights unchanged)"; six starting points (Race Engineer, Driving Coach, Software Architect, Python Developer, AI Research Assistant, General Personal Assistant) created on a chosen base model | gateway `/lab/webui/models` |
| Fine-Tuning Lab | The plan, clearly marked not built | — |
| Production Routing | Local AI Server Mode, AI Inference Monitoring, Local AI Test Console (unchanged) | docs/local-ai.md |

Memory, knowledge bases and configurations are **Open WebUI's own** features; the lab only lists and creates them through Open WebUI's API. Uploading documents, attaching knowledge to a configuration and turning memory on in chats are done in Open WebUI.

## Security

- **Who**: every `/api/admin/ai-lab/*` handler starts with the Admin check (`labAdmin`, 404 otherwise); a test fails if one doesn't. The page is server-rendered only for Admins.
- **Website → Mac**: only to a server registered in Local AI Server Mode (its https URL validated when saved); only to the paths in `LAB_PATHS`; signed with purpose `lab` (a production inference signature can't be replayed as a deletion, nor the other way round; replays and stale timestamps refused); Cloudflare Access service token. A browser never chooses a host or path: no SSRF.
- **On the Mac**: lab routes answer 404 unless `LOCAL_AI_LAB=on`; downloads and deletions also need `LOCAL_AI_LAB_MANAGE=on`; production models (`LOCAL_AI_MODELS`) can't be deleted; every request to Ollama or Open WebUI is rebuilt from checked fields at a fixed path on 127.0.0.1 (model names can't contain `..`, `//`, spaces or a leading `-`; Open WebUI IDs are `[A-Za-z0-9-]`); downloads only by name through Ollama itself; the size check only contacts `registry.ollama.ai`.
- **Secrets**: none reach a browser. Render has the existing `LOCAL_AI_SHARED_SECRET` and Access token; the Mac has the same secret plus `OPEN_WEBUI_API_KEY` and `WEBUI_SECRET_KEY`. The Open WebUI API key is limited to `/api/v1/memories`, `/api/v1/knowledge` and `/api/v1/models` (`API_KEYS_ALLOWED_ENDPOINTS`).
- **Open WebUI**: published on 127.0.0.1 only; reachable from outside only through Cloudflare Access (your email); its own admin login; sign-ups turned off, new accounts `pending`; `X-Frame-Options: DENY`; HSTS; secure cookies; no community sharing or telemetry.
- **Limits**: per Admin, 30 playground runs, 30 model actions, 60 Open WebUI actions and 12 forced status refreshes a minute, 4 playground runs at once; on the Mac, 1 lab generation at a time (refused while production's slots are all busy), context capped at `LOCAL_AI_LAB_MAX_CONTEXT`, output at `LOCAL_AI_LAB_MAX_OUTPUT`, 180 s; one download at a time; bodies size-capped on both sides.
- **Spending**: cloud playground runs are refused when their worst case (estimated input plus every output token allowed, at list price) would take today's lab cloud spend past the daily budget (default $2, 0 turns cloud models off in the lab). They're also the site's own AI calls, so the global spend monitor and the emergency stop (Site Settings) apply.
- **Audit**: downloads, deletions, loads, unloads, cloud runs, memory/knowledge/configuration changes and settings changes go to `"AiLabAuditLog"` (who, what, outcome; kept a year) and Render's log.
- **Production isolation**: the lab's settings are their own `"SiteSettings"` row (`ai_lab`), which `chatModel()` and the Local AI router never read (tested); any installed model can be used in the lab, but only `LOCAL_MODELS` can ever be mapped to a production feature; nothing in Open WebUI is used by production; production keeps its own slots and cloud fallback.

### License (Open WebUI)

Open WebUI is under the **Open WebUI License**: BSD-3-Clause plus a branding clause that forbids altering, removing or replacing the "Open WebUI" name and logo, except for deployments with at most 50 end users in any rolling 30 days, with written permission, or with an enterprise license. It doesn't restrict internal use, modification otherwise, or opening it from another site. RacingCoach runs it **unmodified, unbranded-over, for one user**, as a separate service in its own tab, and doesn't redistribute it, so the clause isn't engaged. Don't white-label it or offer it to customers without revisiting this. (Read 2026-11-24 from the repository's LICENSE; not legal advice.)

## On the MacBook Pro

Commands are run in Terminal from the repository folder (`cd ~/Desktop/Clarivex/racingcoach`, or wherever it's cloned) unless they say otherwise. Stage 0–6 of docs/local-ai.md (Ollama, the gateway, the tunnel and the heartbeat) come first; if they're done, start at step 4.

**1. Processor and memory**

```bash
sysctl -n machdep.cpu.brand_string            # e.g. Apple M4 Max
sysctl -n hw.memsize | awk '{printf "%.0f GB\n", $1/1073741824}'
system_profiler SPHardwareDataType | grep -E "Chip|Memory"
```
Apple Silicon is required for GPU inference. Rough guide: a model needs about its file size in memory plus a few GB for context. 32 GB runs 8–14B models comfortably and a 20–27B model alone; 64 GB+ runs 27–32B models beside production's.

**2. Ollama up to date**

```bash
ollama --version
brew upgrade ollama && brew services restart ollama    # Homebrew install
# The Ollama app updates itself: menu bar icon > Restart to Update when offered
```

**3. Ollama's local API**

```bash
curl -s http://127.0.0.1:11434/api/version     # {"version":"..."}
curl -s http://127.0.0.1:11434/api/tags | head -c 400
curl -s http://127.0.0.1:11434/api/ps          # loaded models
lsof -nP -iTCP:11434 -sTCP:LISTEN              # must show 127.0.0.1:11434, never *:11434
```

**4. Docker Desktop for Apple Silicon**

Download **Docker Desktop for Mac with Apple silicon** from https://www.docker.com/products/docker-desktop/ (or `brew install --cask docker`), open it, accept the terms. Then Docker Desktop > Settings:
- General: **Start Docker Desktop when you sign in to your computer**: on.
- Resources: **Memory** about 4 GB is plenty for Open WebUI. Ollama runs outside Docker, so every GB given to Docker is a GB the models can't use.

```bash
docker version            # Client and Server both answer
docker compose version
```

**5–7. Open WebUI with persistent storage, talking to native Ollama**

```bash
cd local-ai/openwebui
cp .env.example .env
openssl rand -hex 32        # paste it as WEBUI_SECRET_KEY in .env (keep it safe)
ollama pull qwen3-embedding:0.6b   # the embedding model, before the first start (if the tag doesn't exist, use nomic-embed-text and set RAG_EMBEDDING_MODEL in .env)
docker compose pull
docker compose up -d
docker compose ps           # open-webui: running, then healthy after a minute or two
docker exec open-webui curl -s http://host.docker.internal:11434/api/version   # Ollama answers from inside the container
```
`docker-compose.yml` pins **v0.13.4** (verified on ghcr.io on 2026-11-24), publishes **127.0.0.1:8080** only, and keeps all data in the Docker volume **racingcoach-open-webui** (survives container restarts, updates and `docker compose down`; deleted only by `docker volume rm` or `down -v`).

**8. The first admin account (before the hostname is public)**

Open **http://localhost:8080** on the Mac and create your account: **the first account becomes the admin**. Do this before step 7 of Cloudflare below adds `ai-lab.racingcoach.app`, so nobody else can claim it.

**9. Turn off public registration**

Open WebUI > Admin Panel > Settings > General: **Enable New Sign Ups: off**, **Default User Role: pending**. Save. Check in a private window: http://localhost:8080 offers sign-in only. (Cloudflare Access already keeps everyone else out; this is the second lock.)

**10. More models**

From the AI Lab's Models tab (Download, with `LOCAL_AI_LAB_MANAGE=on`), Open WebUI (Admin Panel > Settings > Models), or Terminal:
```bash
ollama pull qwen3:14b        # names from https://ollama.com/library: qwen3, gemma3, gpt-oss, deepseek-r1, llama3.2, mistral-small3.2 ...
ollama list
```
Check a model's page on ollama.com for its tags and size first; the AI Lab's **Check size** reads it from the registry. Production's `OLLAMA_MAX_LOADED_MODELS=2` means loading a third model unloads one; production falls back to the cloud while its model reloads.

**11. Persistent memory**

Open WebUI > Settings (your avatar) > **Personalization > Memory: on**. Add a memory there or on the AI Lab's Memory tab. Memories are per Open WebUI account and live in its database (the Docker volume), so they survive new chats, restarts and switching models.

**12. Local embedding model**

Admin Panel > Settings > **Documents**: Embedding Model Engine **Ollama**, URL `http://host.docker.internal:11434`, model **qwen3-embedding:0.6b** (already set if the first start had it). Recommendation: **qwen3-embedding:0.6b**, multilingual (RacingCoach works in six languages), strong retrieval for its size, about 0.6 GB and fast on Apple Silicon; **nomic-embed-text** is lighter and English-centred; **qwen3-embedding:4b** is stronger if memory allows. Changing the embedding model later means re-indexing every knowledge base (Documents > Reindex).

**13. A knowledge base**

AI Lab > Knowledge > **Create the missing ones**, or Open WebUI > Workspace > Knowledge > +. Then in Open WebUI: open the knowledge base > **+** > upload a PDF or Markdown file. In a chat type `#` and pick it, or attach it to a model configuration (Workspace > Models > Edit > Knowledge). Ask something only the document answers; the answer shows its citations.

**14. Start automatically at login**

- Ollama: the Ollama app starts at login, or `brew services start ollama` (plus `local-ai/launchd/app.racingcoach.ollama-env.plist` for its settings, docs/local-ai.md).
- Open WebUI: Docker Desktop starts at sign-in (step 4) and `restart: unless-stopped` starts the container.
- The gateway: `local-ai/launchd/app.racingcoach.local-ai.plist` (docs/local-ai.md Stage 6).
- cloudflared: its service (docs/local-ai.md Stage 3).

**Gateway settings for the lab** — add to `local-ai/.env` (see `local-ai/.env.example`), then restart the gateway:
```bash
LOCAL_AI_LAB=on
LOCAL_AI_LAB_MANAGE=on                # only if you want downloads/deletions from the website
OPEN_WEBUI_URL=http://127.0.0.1:8080
OPEN_WEBUI_API_KEY=sk-...             # Open WebUI > Settings > Account > API Keys > Create (admin account)
```
```bash
launchctl kickstart -k gui/$(id -u)/app.racingcoach.local-ai
grep "AI Lab routes" /tmp/racingcoach-local-ai.log | tail -1   # AI Lab routes: on (model management on; Open WebUI http://127.0.0.1:8080, API key set)
```
If API Keys isn't offered: Admin Panel > Settings > General (or Authentication) > **Enable API Keys** on, and check the allowed endpoints are `/api/v1/memories,/api/v1/knowledge,/api/v1/models`.

**15. Updating Open WebUI without losing data**

```bash
cd local-ai/openwebui
./backup.sh
# read the release notes: https://github.com/open-webui/open-webui/releases
# set OPEN_WEBUI_VERSION=v<new> in .env
docker compose pull && docker compose up -d
docker compose logs -f open-webui        # migrations run on start; Ctrl+C when it's serving
```
The data is in the volume, not the container, so recreating the container keeps it. To go back: set the old version, `docker compose up -d`, and if the new version migrated the database, `./restore.sh backups/<the backup>`.

**16. Backup and restore**

```bash
cd local-ai/openwebui
./backup.sh                                              # backups/open-webui-<date>.tar.gz (stops it for a few seconds)
./restore.sh backups/open-webui-20261124-120000.tar.gz   # asks you to type RESTORE
```
Back up before every update and now and then (Time Machine covers the backups folder). Keep `.env`'s `WEBUI_SECRET_KEY` with them. Ollama models aren't backed up (`ollama pull` again).

**17. Logs and connectivity**

```bash
docker compose -f local-ai/openwebui/docker-compose.yml logs --tail 100 open-webui
tail -f /tmp/racingcoach-local-ai.log                    # the gateway (production and lab)
tail -f ~/.ollama/logs/server.log                        # Ollama app (Homebrew: $(brew --prefix)/var/log/ollama.log)
tail -f ~/Library/Logs/com.cloudflare.cloudflared.err.log
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8080/health   # 200
node local-ai/gateway.ts heartbeat                         # status 200
cloudflared tunnel info <tunnel name>
```

**18. Stop and restart everything**

```bash
# Stop
docker compose -f local-ai/openwebui/docker-compose.yml stop
launchctl bootout gui/$(id -u)/app.racingcoach.local-ai   # sends a last "not accepting" heartbeat
brew services stop ollama                                  # or quit the Ollama app
# Start
brew services start ollama
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/app.racingcoach.local-ai.plist
docker compose -f local-ai/openwebui/docker-compose.yml start
```
cloudflared can keep running; with nothing behind it the hostnames answer 502.

### macOS sleep

Sleeping freezes Ollama, the gateway, Docker and cloudflared. RacingCoach marks the server offline within 30 s and production goes to the cloud; the AI Lab says the Mac can't be reached (polling slows to every 15 s, and pauses while the tab is hidden). On wake everything reconnects by itself. To keep it awake on the charger: System Settings > Battery > Options > **Prevent automatic sleeping on power adapter when the display is off**, or `sudo pmset -c sleep 0` (undo with `sudo pmset -c sleep 1`); `pmset -g` shows the settings; `caffeinate -s` keeps it awake while that Terminal window is open. Closing the lid sleeps a MacBook unless an external display, power and keyboard are connected.

## Cloudflare

The existing tunnel and `ai.racingcoach.app` Access application are reused unchanged; the website's lab traffic goes through them. One new hostname is added, for you to open Open WebUI in a browser.

1. **Order matters**: do Mac steps 5–9 first (admin account created, sign-ups off).
2. **Hostname on the existing tunnel**:
   - *Dashboard-managed tunnel* (installed with a token): Zero Trust > Networks > Tunnels > your tunnel (`racingcoach-mac`) > **Public hostnames** (or *Published application routes*) > Add: subdomain `ai-lab`, domain `racingcoach.app`, path empty, service **HTTP** `127.0.0.1:8080`. This creates the DNS record.
   - *Locally-managed tunnel* (`~/.cloudflared/config.yml`): add the hostname above the catch-all and route DNS:
     ```yaml
     ingress:
       - hostname: ai.racingcoach.app
         service: http://127.0.0.1:8787
       - hostname: ai-lab.racingcoach.app
         service: http://127.0.0.1:8080
       - service: http_status:404
     ```
     ```bash
     cloudflared tunnel route dns <tunnel name> ai-lab.racingcoach.app
     launchctl kickstart -k gui/$(id -u)/com.cloudflare.cloudflared
     ```
3. **Access application** (before testing the hostname): Zero Trust > Access > Applications > Add > **Self-hosted**: name `RacingCoach AI Lab`, domain `ai-lab.racingcoach.app`, session duration 24 hours. Policy `Owner`: **Action Allow**, Include **Emails** = your email address(es). Login method: **One-time PIN** (the default) and/or Google. No other policies; don't add the Render service token here (Render never calls this hostname).
4. **WebSockets**: Open WebUI streams chats over WebSockets. Cloudflare allows them by default (your zone > Network > WebSockets: on).
5. **Test**:
   - A private window to https://ai-lab.racingcoach.app → Cloudflare's sign-in → the PIN emailed to you → Open WebUI's sign-in → your admin account.
   - `curl -sI https://ai-lab.racingcoach.app | head -3` → a 302 to `*.cloudflareaccess.com` (Access is protecting it).
   - `curl -i https://ai.racingcoach.app/lab/status` → 403 from Cloudflare (still service-token only).
6. **On the AI Lab page**: Overview > AI Lab settings > Open WebUI address `https://ai-lab.racingcoach.app` > Save.

Never add a public hostname for `127.0.0.1:11434` (Ollama). Nothing on the Mac listens beyond 127.0.0.1.

## Render

**No new environment variables are needed.** The lab uses what production local AI already has:

| Key | Purpose | Required for the lab |
|---|---|---|
| `LOCAL_AI_SHARED_SECRET` | Signs requests to the Mac (also `lab` ones) | Yes (already set for local AI) |
| `LOCAL_AI_CF_ACCESS_CLIENT_ID`, `LOCAL_AI_CF_ACCESS_CLIENT_SECRET` | Passes Cloudflare Access at `ai.racingcoach.app` | Yes (already set) |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY` | Frontier models in the playground | Only for the providers you compare |

Stays only on the Mac: `OPEN_WEBUI_API_KEY`, `WEBUI_SECRET_KEY`, the `LOCAL_AI_LAB*` switches.

- **Deploy**: merge to `main`; Render deploys after CI passes. No build or start command changes.
- **Database**: created on first use, additive only: `"AiLabPrompts"`, `"AiLabBenchmarks"`, `"AiLabAuditLog"`, and `"AiInferenceEvents"`' `source` check widened to allow `aiLab` (once, only if it doesn't yet). Nothing to run by hand.
- **Health check**: unchanged; the lab is never part of it, so a sleeping Mac can't fail a deploy.
- **Timeouts**: lab status 8 s, model actions 30 s (load 75 s; it answers "still loading" after 60 s), playground runs up to 4 minutes, streamed so Cloudflare never waits 100 s for a first byte.
- **Server registered**: the lab uses the server registered in Production Routing > Local AI Server Mode (`https://ai.racingcoach.app`). Its Enabled switch only affects production routing.

## Proof of concept

Expected results assume the steps above. "Lab" = the AI Lab page on https://racingcoach.app/model-learning, signed in as an Admin.

| # | Do | Expect | If not |
|---|---|---|---|
| 1 | `curl -s http://127.0.0.1:11434/api/version` | `{"version":...}` | `brew services start ollama` / open the app |
| 2 | `docker compose -f local-ai/openwebui/docker-compose.yml ps` | open-webui healthy | `docker compose logs open-webui`; Docker Desktop running? |
| 3 | `node local-ai/gateway.ts heartbeat`, `tail /tmp/racingcoach-local-ai.log` | 200; "AI Lab routes: on ... API key set" | docs/local-ai.md troubleshooting |
| 4 | Open the lab | Overview loads | 404 means not an Admin |
| 5 | Overview | Gateway, Ollama, Open WebUI and production heartbeat green; versions shown | Gateway yellow "routes are off": `LOCAL_AI_LAB=on`. Open WebUI yellow: API key missing. Red: see the error under it |
| 6 | Models tab | Your Ollama models with family, size, quantization | Test Connection on Overview |
| 7 | Launch Open WebUI | New tab → Cloudflare PIN → Open WebUI sign-in | Cloudflare step 3; Overview settings URL |
| 8 | Chat with a local model in Open WebUI | Streams an answer | Admin Panel > Settings > Connections: Ollama `http://host.docker.internal:11434` verified |
| 9 | Settings > Personalization > Memory on; add "My main car is the Porsche 911 GT3 R (992)" | Listed in the lab's Memory tab after Refresh | Memory tab says API key missing: step 14 |
| 10 | New chat: "What car do I race?" | It names the Porsche | Memory toggle on; the model is small: try another; Memory tab > Test retrieval shows what the search finds |
| 11 | Switch model, ask again | Same memory used (it's per account, not per model) | as 10 |
| 12 | Knowledge: create Race Engineering, upload a PDF | Files count > 0 in the lab after Refresh | Admin Panel > Settings > Documents: embedding model pulled? `docker compose logs` |
| 13 | New chat, `#Race Engineering`, ask something only the PDF answers | Answer with citations | Reindex; check the embedding model |
| 14 | Lab > Model Configurations > create RacingCoach Race Engineer on your model | Listed as "Configuration (base weights unchanged)"; appears in Open WebUI's model list | Open WebUI version differs: create it in Workspace > Models instead and report the error shown |
| 15 | Playground: a local model + gpt-4o-mini, same prompt, Run | Both answers side by side; local cost $0; tokens/s; first token on the Mac and on the server; fallback none | Budget > 0 in settings; OPENAI_API_KEY on Render |
| 16 | Overview / Production Routing > AI Inference Monitoring | The runs counted (source aiLab), local and frontier | Refresh |
| 17 | Stop the gateway (`launchctl bootout ...`) or sleep the Mac | Overview red within 15 s; production features keep answering (cloud) | — |
| 18 | Use a production AI feature (e.g. Lap Compare summary) | Works as normal | It never depended on the Mac |
| 19 | Start the gateway again / wake the Mac | Green within ~15 s; production heartbeat back within 10 s | Refresh Status |

## Troubleshooting

- **Overview: "routes are off"** — `LOCAL_AI_LAB=on` in `local-ai/.env`, restart the gateway.
- **"Cloudflare Access refused"** — the service token on Render vs the `ai.racingcoach.app` policy (docs/local-ai.md Stage 4).
- **Open WebUI yellow** — no `OPEN_WEBUI_API_KEY`, or API keys disabled in Open WebUI. **Red** — container down (`docker compose ps`) or `OPEN_WEBUI_URL` wrong.
- **Memory/Knowledge errors with 403 from Open WebUI** — the key's allowed endpoints don't include that path (Admin Panel > Settings > Authentication).
- **Open WebUI can't see Ollama** — `docker exec open-webui curl -s http://host.docker.internal:11434/api/version`. If that fails, restart Docker Desktop; don't bind Ollama to 0.0.0.0.
- **Signed out of Open WebUI after an update** — `WEBUI_SECRET_KEY` changed; restore it from your records.
- **Safari won't keep you signed in on http://localhost:8080** — the cookies are `Secure`; use the https hostname, or Chrome/Firefox for localhost.
- **Load says "still loading"** — normal for big models; Overview shows it loaded when done.
- **Playground "lab slot busy" / "production busy"** — one lab run at a time, and none while production's slots are full. Wait.
- **Download fails "file does not exist"** — the name/tag isn't in the registry; check ollama.com.

## Evaluated, not built: Mem0 or a pgvector memory layer

Open WebUI's memory covers experimentation now. **Mem0** (Apache-2.0, can run on Ollama with a local vector store) adds automatic extraction and updating of memories from conversations and an API other tools can share; worth trying once memories should be written automatically or used outside Open WebUI. A **custom Postgres/pgvector layer** only makes sense if memory moves into production (per-driver coaching memory), which would be personal data: privacy inventory, export, erasure and retention first, and Render Postgres's pgvector extension (the site currently does cosine in memory). Neither is needed for the lab today.

## Phase 4: Fine-Tuning Lab (architecture plan)

Training runs on the Mac with **Apple MLX / MLX-LM** (`mlx_lm.lora`), separate from Ollama and Open WebUI, which serve models.

- **Where things live**: a Python package `local-ai/finetune/` (MLX-LM, run in its own venv); datasets, checkpoints and adapters under `~/RacingCoachLab/` on the Mac, never in the repository or R2 by default. The website stores **metadata only**: `"AiLabDatasets"` (name, version, row counts, checksum, validation result), `"AiLabTrainingRuns"` (base model, LoRA rank/alpha/layers, learning rate, batch size, iterations, status, loss history as JSONB), `"AiLabAdapters"` (run, version, path on the Mac, evaluation scores, deployed name).
- **Gateway**: new `/lab/train/*` routes behind `LOCAL_AI_LAB_TRAIN=on`: validate dataset, start run (one at a time, never while production is busy beyond a threshold), status with the loss curve, cancel, evaluate, deploy, roll back. Same `lab` signature, same allowlist approach.
- **Datasets**: JSONL in chat format (`{"messages":[...]}`), split train/valid/test (e.g. 80/10/10) with a fixed seed; validation checks the format, token lengths against the base model's context, duplicates across splits, and flags anything that looks like personal data (email addresses, names in the users table); nothing from production customers without a legal basis and a decision.
- **Training**: `mlx_lm.lora --model <hf base> --train --data <dir> --batch-size --iters --learning-rate --num-layers --adapter-path`, streamed loss lines parsed into the run record; QLoRA by starting from a 4-bit MLX base.
- **Evaluation**: the held-out test set (loss, plus task checks), and the playground comparing base, adapter and frontier models on saved benchmark prompts.
- **Deployment**: `mlx_lm.fuse` then GGUF (llama.cpp) for Ollama, or Ollama's `ADAPTER` in a Modelfile where the architecture supports it; served as `rc-ft-<base>-v<n>`, labelled **fine-tuned** on the Models and Configurations tabs. Rollback is switching back to the previous name. A fine-tuned model reaches production only by being added to `LOCAL_MODELS` in code and mapped in Production Routing, never automatically.
- **UI**: the Fine-Tuning Lab tab gets Datasets, Runs (with the loss chart), Adapters and Evaluate sub-tabs, reusing the lab's polling and audit log.

## Limitations

- Built and tested against stand-ins, not a live Open WebUI: the Open WebUI routes may need adjusting to the exact response shapes of 0.13.4 (the proof of concept, steps 9–14, is the check).
- Memory "Test retrieval" shows what Open WebUI's memory search returns and asks a model with those memories in its system prompt; that's the same idea as Open WebUI's chats, not a call through Open WebUI's own chat pipeline.
- Status is cached per web server instance (one instance today).
- Context length shown "served" is what Ollama reports for a loaded model; unloaded models show their maximum and Modelfile `num_ctx` only.
- `local-ai/Modelfile` says `FROM qwen3.8:27b`, which isn't an Ollama model name (Qwen3 comes in 0.6b, 1.7b, 4b, 8b, 14b, 30b, 32b and larger). Fix the `FROM` line before `ollama create`.
