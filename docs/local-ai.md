# Local AI inference (hybrid local + cloud)

RacingCoach can answer AI features with open-weight models (GPT-OSS 20B, Qwen3 8B) running in Ollama on the owner's Mac, while the existing cloud models (OpenAI, Anthropic, DeepSeek) stay in place and take over whenever the Mac is offline, asleep, busy, failing or unsuitable. The Mac is never a single point of failure: every local attempt has a cloud fallback, and the default mode is **Cloud Only**.

## Architecture

```
Browser ── racingcoach.app (Render) ── chatModel(feature) ──┬─▶ cloud model (as before)
                                                            │
                                                            └─▶ RoutedChatModel ── decideRoute ──┬─▶ cloud model
                                                                                                 │
           https://ai.racingcoach.app  ◀── HTTPS + CF Access service token + HMAC signature ─────┘
                  │  (Cloudflare Access checks the token at Cloudflare's edge)
          cloudflared tunnel (outbound from the Mac; no open ports)
                  │
          127.0.0.1:8787  local-ai/gateway.ts   (only GET /health, POST /v1/chat/completions; allowed models; 2 slots)
                  │
          127.0.0.1:11434 Ollama                 (never reachable from outside)

Mac ── POST https://racingcoach.app/api/local-ai/heartbeat every 10 s (HMAC-signed) ──▶ Render's memory
```

- **One choke point.** Every AI call in the site goes through `chatModel()` (`src/lib/aiModels.ts`). In Cloud Only and Development modes, or for a feature with no local model, it returns the cloud model exactly as before, with one extra callback that records the call. In Automatic mode, a mapped feature gets a `RoutedChatModel` (`src/lib/localAi/routedModel.ts`) wrapping that same cloud model.
- **Per model call.** The router decides each model call on its own (an agent's tool loop makes several), from the registered servers, their last heartbeat (judged by Render's clock), free slots and circuit breaker (`src/lib/localAi/routing.ts`).
- **Fallback before output.** A local attempt must finish, and its answer must be usable (tool calls name bound tools, JSON when a response format was asked for, a required tool call made, not empty). Otherwise the same messages go to the cloud model, and only that answer is returned. Nothing streams, so answers are never spliced. Tools run only after the model call returns its one answer, so a fallback never repeats a tool (tested with a real `createAgent`). When the caller's own time limit aborts, nothing falls back.
- **Limits unchanged.** `aiRateLimit` counts the route's call once, before any model call, whether it ends up local, cloud or both. The emergency stop (`meteredServices`) stops local calls too. Cloud fallback tokens go to `AiUsage` and the spend monitor as before. Local tokens aren't added to `AiUsage`, so cost reports and the spend ceiling stay cloud-only; they're in `AiInferenceEvents`.
- **Concurrency.** At most `min(server slots on the Admin page, LOCAL_AI_MAX_CONCURRENCY on the Mac)` generations at once (default 2). Render takes a slot synchronously before calling. A call that finds none goes straight to the cloud (`localBusy`), and the gateway refuses a third with 503 `local_busy` too. There's no queue: 10 simultaneous requests are 2 local + 8 cloud.
- **Circuit breaker.** 3 consecutive local failures (timeouts, errors, unusable answers; not busy or canceled) open a server's circuit for 60 s. After that one trial request goes through, and success closes it.
- **Heartbeat in memory.** Heartbeats are kept in the web server's memory (like Live Racing). They're written to Postgres at most once a minute per server, only for "last seen" after a restart. After a deploy a server counts as offline until its next heartbeat (≤ 10 s). With several Render instances, each would need its own heartbeats (see Limitations).

### Modes (Admin > Local AI Server Mode, `"SiteSettings"` key `local_ai`)

| Mode | New requests | Requests running on the Mac |
|---|---|---|
| **Cloud Only** (default; also what any unreadable setting means) | Cloud, exactly as before | Finish |
| **Development** | Cloud | Finish. Also: `node local-ai/gateway.ts dev on` on the Mac refuses new ones locally |
| **Automatic** | Mapped features → healthy local server with a free slot, else cloud | — |

### Feature mapping defaults (`DEFAULT_FEATURE_MODELS`, `src/lib/localAi/config.ts`)

GPT-OSS 20B: Lap Summary, Multi-Lap Summary, Stint Summary, Racecar Analysis. Cloud only: Debrief Coach, Race Trends and Race Coaching (many tool calls over big contexts), plus the live features (In-Car AI Coach, Race Announcers, Race Engineer, Setup Engineer), whose moment passes in seconds. Change any of these on the Admin page once you've benchmarked.

### Models

| Ollama tag | Label | License | Model max context | Served context (`OLLAMA_CONTEXT_LENGTH`) | Memory |
|---|---|---|---|---|---|
| `gpt-oss:20b` | GPT-OSS 20B | Apache 2.0 | 131,072 | 32,768 | ~14 GB |
| `qwen3:8b` | Qwen3 8B | Apache 2.0 | 40,960 | 32,768 | ~5 GB |

Both support tool calling in Ollama's OpenAI-compatible API. Requests whose estimated input is over 75% of the served context go to the cloud (`contextTooLarge`). GPT-OSS gets `reasoning_effort: low`. The gateway strips `<think>…</think>` from answers. MLX could replace Ollama later behind the same gateway, since the gateway only needs an OpenAI-compatible `/v1/chat/completions`.

### Data

- `racingcoach."LocalAiServers"`: the registered servers (ID, name, gateway URL, slots, enabled, last heartbeat).
- `racingcoach."AiInferenceEvents"`: one row per model call attempt, written as it finishes (`src/lib/localAi/events.ts`). Each row has the attempt ID, logical request ID (a local attempt and its cloud fallback share one), feature, caller category, source (`app` / `testConsole`), provider, server, requested and actual model (what the provider's response says), status (`completed`, `failed`, `timedOut`, `canceled`), route reason, fallback flag, error kind, tokens, latency and estimated cost. It never stores a user, IP address, prompt or answer, so both tables are in `NON_PERSONAL_TABLES`. Kept 90 days (hourly purge on the live server).
- Created lazily by `ensureLocalAiSchema()` (additive `CREATE ... IF NOT EXISTS`, like the engineering knowledge base), not by `ensureUserSchema`, so a problem here can't stop the site.

### Security

- Ollama listens on 127.0.0.1 only. The gateway also binds 127.0.0.1 and exposes exactly `GET /health` and `POST /v1/chat/completions` (allowed models only, no streaming, 4 MB bodies). Model management (`/api/pull`, `/api/delete`, ...) is unreachable from outside (tested).
- Two independent locks on the tunnel: **Cloudflare Access** (only the Render service token gets past Cloudflare's edge) and an **HMAC-SHA256 signature** with `LOCAL_AI_SHARED_SECRET` over purpose, method, path, timestamp, nonce and body hash. The gateway checks it, refusing timestamps more than 60 s off and nonces already seen (no replays). A heartbeat signature can't be used as an inference one.
- Heartbeats are signed the same way and must name a server an Admin registered and enabled, so nobody can register a server or speak for one. Availability uses Render's receive time, never the Mac's clock.
- No secret reaches a browser; the Admin page shows only whether they're set. Admin routes answer 404 to anyone without the Admin role. Gateway URLs must be `https://` with no path in production.

## Setup

Do it in this order. Each stage can be verified before the next.

### Stage 0: what's needed

- The Mac (Apple Silicon, 32 GB+ to run both models with room; 64 GB+ recommended), macOS current, Node 22.18 or later (`node -v`), this repository cloned.
- The racingcoach.app domain's DNS on Cloudflare (a zone in the Cloudflare dashboard). If it isn't, Cloudflare Tunnel needs another domain that is.

### Stage 1: Ollama and the models (on the Mac)

```bash
brew install ollama            # or install the app from https://ollama.com/download
# Server settings (the Ollama app reads them from launchd; restart Ollama after setting them)
launchctl setenv OLLAMA_CONTEXT_LENGTH 32768
launchctl setenv OLLAMA_NUM_PARALLEL 2
launchctl setenv OLLAMA_MAX_LOADED_MODELS 2
launchctl setenv OLLAMA_KEEP_ALIVE 30m
# OLLAMA_HOST stays unset: 127.0.0.1:11434. Never set it to 0.0.0.0.
brew services restart ollama   # or quit and reopen the Ollama app

ollama pull gpt-oss:20b
ollama pull qwen3:8b
ollama list                                           # both listed
curl -s http://127.0.0.1:11434/api/tags | head -c 300 # Ollama answers locally
ollama run qwen3:8b "Say ready" --verbose              # a real generation, with tokens/s
```

`launchctl setenv` lasts until reboot. To keep it, put the same lines in a LaunchAgent, or re-run them after a restart.

### Stage 2: a local end-to-end test, no Cloudflare (on the Mac, with `npm run dev`)

1. Make a shared secret: `node local-ai/gateway.ts secret`.
2. Add it to `.env.local` as `LOCAL_AI_SHARED_SECRET=...` and restart `npm run dev`.
3. `cp local-ai/.env.example local-ai/.env`. Set `LOCAL_AI_SHARED_SECRET` to the same value and `LOCAL_AI_HEARTBEAT_URL=http://localhost:3000/api/local-ai/heartbeat`.
4. Admin > Local AI Server Mode > **Add server**: ID `macbook-pro`, Gateway URL `http://127.0.0.1:8787` (allowed only off the live server), slots `2`.
5. `npm run local-ai`. The log should say `Heartbeat: HTTP 200 {"ok":true,"mode":"cloudOnly",...}`.
6. Admin > Local AI Test Console > **Test Local Connectivity**, then **Send Prompt** (routing Force local). Expect "Answered by Local gpt-oss:20b", and the call in AI Inference Monitoring.

### Stage 3: Cloudflare Tunnel (dashboard + Mac)

1. Cloudflare dashboard → **Zero Trust** (one.dash.cloudflare.com) → **Networks → Tunnels** (may be labeled *Connectors → Cloudflare Tunnels*) → **Create a tunnel** → type **Cloudflared** → name `racingcoach-mac` → Save.
2. On *Install and run a connector*, choose **macOS**. On the Mac:
   ```bash
   brew install cloudflared
   sudo cloudflared service install <TOKEN shown in the dashboard>
   ```
   This runs cloudflared at boot as a launchd service. The tunnel then shows **Healthy** in the dashboard.
3. **Public hostnames** tab (may be labeled *Published application routes*) → **Add**: Subdomain `ai`, Domain `racingcoach.app`, Path empty, Service type **HTTP**, URL `127.0.0.1:8787` → Save.
   - **DNS:** this creates the proxied CNAME `ai.racingcoach.app → <tunnel-id>.cfargotunnel.com` for you. No other DNS change is needed, and no ports open on the Mac or router.
4. Check: `curl -i https://ai.racingcoach.app/health` returns **401** `unauthorized` from the gateway (Access isn't on yet). If it returns 502 or 1033, see Troubleshooting.

### Stage 4: Cloudflare Access (dashboard)

1. **Zero Trust → Access → Service auth → Service Tokens → Create Service Token**: name `racingcoach-render`, duration *Non-expiring* (or 1 year, with a reminder to rotate). Copy the **Client ID** and **Client Secret** now; the secret is shown once.
2. **Zero Trust → Access → Applications → Add an application → Self-hosted**: name `RacingCoach Local AI`, domain `ai.racingcoach.app` (path empty).
3. Add a policy: name `Render service token`, **Action: Service Auth**, Include → **Service Token** → `racingcoach-render`. Add no other policies (no Allow for emails), so no browser login can reach it. Save.
4. Check from any computer:
   - `curl -i https://ai.racingcoach.app/health` → **403** from Cloudflare (Access blocks it).
   - `curl -i -H "CF-Access-Client-Id: <id>" -H "CF-Access-Client-Secret: <secret>" https://ai.racingcoach.app/health` → **401** from the gateway (unsigned): both layers work.
   - A wrong secret in either header → 403 from Cloudflare.

### Stage 5: Render (dashboard)

Render → the `racingcoach` web service → **Environment** → add (as secrets, never in the repo):

| Key | Value |
|---|---|
| `LOCAL_AI_SHARED_SECRET` | the secret from Stage 2 (the same as the Mac's `local-ai/.env`) |
| `LOCAL_AI_CF_ACCESS_CLIENT_ID` | the service token's Client ID |
| `LOCAL_AI_CF_ACCESS_CLIENT_SECRET` | the service token's Client Secret |

Save and let it redeploy (or deploy this branch). On the live Admin page, add the server: ID `macbook-pro`, Gateway URL `https://ai.racingcoach.app`, slots `2`. Leave the mode on **Cloud Only**.

If racingcoach.app is proxied through Cloudflare with Bot Fight Mode or a WAF challenge, add a rule that skips them for `/api/local-ai/heartbeat`, or the Mac's heartbeats may be challenged. The heartbeat's own signature protects the route.

### Stage 6: the heartbeat agent (Mac)

1. In `local-ai/.env`, set `LOCAL_AI_HEARTBEAT_URL=https://racingcoach.app/api/local-ai/heartbeat` and `LOCAL_AI_SERVER_ID=macbook-pro`. Keep the secret from Stage 2.
2. Test one heartbeat: `node local-ai/gateway.ts heartbeat` → `{ status: 200, body: '{"ok":true,"mode":"cloudOnly",...}' }`.
   - 401 `badSignature`: the secrets differ. 401 `stale`: the Mac's clock is off (System Settings → General → Date & Time → automatic). 403: the server ID isn't registered or enabled. 503: Render has no `LOCAL_AI_SHARED_SECRET`.
3. Run it: `npm run local-ai` (Ctrl+C stops it and sends a final "not accepting" heartbeat, so Render stops routing at once).
4. **Start automatically**: edit `local-ai/launchd/app.racingcoach.local-ai.plist` (REPO = repository path, NODE = `which node`), then:
   ```bash
   cp local-ai/launchd/app.racingcoach.local-ai.plist ~/Library/LaunchAgents/
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/app.racingcoach.local-ai.plist
   tail -f /tmp/racingcoach-local-ai.log
   ```
   Stop it: `launchctl bootout gui/$(id -u)/app.racingcoach.local-ai`.
5. **During development** use one of these:
   - `node local-ai/gateway.ts dev on`: the gateway refuses new requests and the heartbeat says so. Render routes to the cloud within 10 s. Undo with `dev off`.
   - The Admin page's **Development** mode: for everyone, from anywhere.
   - Stop the agent entirely (Ctrl+C or `launchctl bootout`).
6. Verify offline and recovery: stop the agent. AI Inference Monitoring shows the server **Offline** within 30 s (immediately on Ctrl+C). Start it again, and it's **Online** within 10 s. In Automatic mode, the next mapped call goes local.

### macOS sleep

When the Mac sleeps, Ollama, the gateway and cloudflared freeze. Heartbeats stop, Render marks the server offline after 30 s, and any request in flight times out (local timeout, default 60 s) and falls back to the cloud. Requests in the meantime go straight to the cloud. On wake, launchd keeps the agent running, cloudflared reconnects, and the next heartbeat (≤ 10 s) brings routing back. To keep it awake while plugged in: System Settings → Battery → Options → *Prevent automatic sleeping on power adapter when the display is off*, or `caffeinate -s` in a terminal. Availability never depends on it.

## Proof of concept (tests A–G)

The automated suites run without a Mac: `npm run test:local-ai` (with `LOCAL_AI_TEST_DATABASE_URL` for the database part). The live checks below need the Mac and Cloudflare. Use Admin > Local AI Test Console and AI Inference Monitoring (Refresh Statistics).

| Test | Do | Expect |
|---|---|---|
| A: local available | Mode **Automatic**; console routing *As production*, model GPT-OSS 20B, the brake bias prompt | "Answered by Local gpt-oss:20b", no fallback; GPT-OSS 20B / Local row +1 Requests, +1 Successful |
| B: Mac offline | Stop the agent (or `brew services stop ollama`); send again | Answered by the cloud (gpt-4o-mini), "Fallback occurred: Mac offline" (or *local attempt failed* within the first 30 s); Cloud fallbacks +1; the page stays responsive |
| C: Development | Mode **Development**; send (As production) | Cloud, route "Development mode", not a fallback; the Mac's log shows no request |
| D: Cloud Only | Mode **Cloud Only**; send | Cloud, route "Cloud Only mode"; no local attempt |
| E: overload | Automatic; send from 3+ browser tabs at once with a long prompt (or set slots to 1) | 2 answered locally, the rest "Fallback: local slots full" |
| F: reconnect | Start Ollama and the agent again | Online within 10 s; the next send is local (a stuck circuit can be reset on the server's row) |
| G: counters | Run several of the above | The model usage rows match what each test showed: attempts per model, one request counted per fallback pair |

**Test Cloud Fallback** makes the local attempt fail on purpose (recorded with error `simulated`, never counted against the circuit), so B's recording can be checked without unplugging anything.

## Troubleshooting

- **Tunnel Down / error 1033**: cloudflared isn't running. `sudo launchctl list | grep cloudflared`, `cloudflared tunnel list`; reinstall with the dashboard's token.
- **502 Bad Gateway** through the tunnel: the gateway isn't listening on 127.0.0.1:8787 (`lsof -iTCP:8787`), or the public hostname points elsewhere.
- **403 from Cloudflare**: Access refused the service token. Check the policy is *Service Auth* with that token, and the Render values.
- **401 from the gateway**: the signature failed. Make sure the same `LOCAL_AI_SHARED_SECRET` is on both sides, and the Mac's clock is right. The gateway logs the reason once a minute.
- **Online but every call falls back with `modelUnavailable`**: the model isn't pulled (`ollama list`), or it isn't in `LOCAL_AI_MODELS`.
- **`localInvalidOutput`**: the local model answered in the wrong shape (no JSON, an unknown tool). Map that feature back to Cloud only, or try the other model.
- **Circuit Open**: 3 recent local failures. It retries on its own after 60 s, or use **Reset circuit**.

## Limitations and later work

- Heartbeat state is per web server instance. Today's single Render instance is fine. For more instances, move it to Render Key Value (Redis), or have each instance probe `/health`.
- Request priority isn't a separate input: the live features are kept on the cloud by mapping, and local work is bounded by slots and timeouts.
- One shared secret for all servers. Per-server secrets (and verifying Cloudflare's `Cf-Access-Jwt-Assertion` on the gateway) would harden a multi-server setup.
- The gateway doesn't stream, and the site doesn't need it to.
- Local tokens aren't in the Account page's My AI Usage (it reads `AiUsage`); they're in AI Inference Monitoring.
- MLX: swap Ollama for `mlx_lm.server` (OpenAI-compatible) behind the same gateway, after a benchmark.
