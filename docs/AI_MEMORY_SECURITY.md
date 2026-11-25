# Clarivex Memory Service: security, privacy and per-user memory

RacingCoach is a public commercial site, so the Memory Service starts locked down: the Memory Manager and every Admin route are Admins only (404 to anyone else), customer capture is off, and private content never leaves the site and the owner's Mac unless a setting explicitly allows it.

## Callers

| Caller | How | Reaches |
|---|---|---|
| Admin in the Memory Manager | site session, role checked on every request | every shared namespace; a user's own space only by naming it (audited) |
| API client (Open WebUI, future apps) | `Authorization: Bearer cmk_…` | its scopes and namespace grants |
| API client acting for end users | scope `memory:users`, `X-Memory-Subject: user:<id>` | only that user's own space for the client's application, plus approved globals |
| The site's own features | `src/lib/memory/userMemory.ts`, user ID from the session | only that user's own space |

Keys are 192-bit random, shown once, stored as SHA-256. Each acts for the Admin who created it and stops working if that account stops being an Admin. A key with subjects (e.g. Open WebUI user IDs) must send one of them in `X-Memory-Subject`; the server checks it and never trusts the caller to say who it is. Scopes: `memory:read`, `memory:write`, `memory:extract`, `memory:feedback`, `memory:users`; `memory:admin` is never given to a key.

## Per-user memory

Each customer's memory is theirs alone: separate from every other user's, and from the owner's personal and administrator memories.

**Layout.** Every end user gets a space per application, created on first use (`ensureUserNamespace`):

```text
users/                      shared root, customer data, holds no memories itself
  u42/                      owned by account 42
    racingcoach             owned by 42: what RacingCoach remembers about this user
    talkninja               owned by 42: TalkNinja's, later; never read by RacingCoach
  u43/
    racingcoach             owned by 43
```

**Four independent checks** keep one user's memories away from another:

1. **Ownership decides, not grants** (`resolveNamespaces` in `rules.ts`). An owned namespace is reachable only by a caller acting as that exact user (`actingUserId`). No grant covers it: not an Admin's implicit "all", not a key's grant on `users/`. An Admin can open one only by naming it, and that is written to the audit log (`namespace.userAccess`). Two users' spaces can never be combined in one request (`mixesUsers`), and a user's space never mixes with shared namespaces other than approved globals (`mixesCustomerData`).
2. **Identity comes from the server.** `userMemory.ts` takes the user ID from the session; a `memory:users` key must name `user:<id>` for an account that exists, and then has no shared namespaces at all (a key with `memory:users` can't also have namespace grants). A user ID in a request body is never used to choose a space.
3. **The owner check in SQL** (`ownerGuard` in `retrieval.ts`). Every retrieval and similarity query adds `n.owner_user_id IS NULL OR n.owner_user_id = <acting user>`. Even if a bug handed a query another user's namespace ID, Postgres would return nothing (tested).
4. **The database ties memories to owners.** A trigger sets every memory's `user_id` to its namespace's owner, so a memory in someone's space always belongs to them; a CHECK keeps owned namespaces customer data; `users/` is reserved (no one can create a namespace under it by hand); extraction jobs re-check that the job's namespace belongs to whoever queued it.

**What a customer's space is subject to:**

- **Capture off by default.** Until System Settings turns on customer capture, the ceiling makes a customer space Read Only, so nothing is extracted from customers' conversations. Before turning it on: Privacy Policy and Terms changes, and a consent switch for users (the legal basis recorded in the inventory is consent).
- **The user's own mode wins.** A per-user setting (MemorySettings `user` scope, e.g. Disabled when they opt out) overrides application and namespace modes.
- **Their data rights.** The `aiMemory` category of the personal data inventory: Download My Data includes `ai_memory/memories.json`, `history.json` and `proposed.json`. Delete Account queues every Mem0 copy for deletion (`purgeUserMemory`), then the account's cascade removes the spaces, memories, history, embeddings, candidates and logs. The daily reconciliation removes any Mem0 copy that was missed.
- **Never training data** unless that's authorized: datasets exclude customer namespaces.

**Using it from a RacingCoach feature** (example, not yet wired into any feature):

```ts
import { retrieveForUser, proposeForUser } from '@/lib/memory/userMemory';
const user = await getCurrentUser();
const { context } = await retrieveForUser(user.id, question);          // only this user's memory
// add `context` as its own message before the conversation, never into the system prompt
await proposeForUser(user.id, [{ role: 'user', content: question }]); // queued; no-op while capture is off
```

**Row-level security, evaluated.** Postgres RLS (`USING (owner_user_id IS NULL OR owner_user_id = current_setting('app.acting_user')::int)`) would add a fifth check, but the site uses one database role through a shared pool, so every query would need `SET LOCAL app.acting_user` inside a transaction, and a forgotten one fails open for the table owner unless `FORCE ROW LEVEL SECURITY` is on. The SQL owner check above gives the same guarantee for the queries that read user memory, without that pooling risk. Revisit RLS if the service moves to its own database with a dedicated role.

## Content safety

- **Secrets are never stored**, whatever the mode: private keys, OpenAI/AWS/GitHub/Slack/Stripe/Google keys, JWTs, bearer tokens, connection strings with passwords, `password:`-style text, session cookies, Luhn-valid card numbers, and high-entropy tokens (`detectSensitive`). Manual creation answers 422; extraction stores the candidate only as `[redacted]`; conversations are redacted before any model sees them.
- **Personal data** (emails, phone numbers, special categories) is flagged sensitive, always reviewed, and left out of retrieval unless an Admin asks.
- **Prompt injection and memory poisoning.** Conversations and documents are untrusted. Instruction-like candidates are flagged, capped at confidence 0.3 and never auto-saved. Retrieved memories go in a labelled `<memory_context>` block that says it is reference data and can't be closed by a memory's text. Instruction-category memories are never system instructions. No memory content can change settings, which only Admins change through audited routes.
- **SQL injection**: every value is a parameter; sorts are a fixed column map. The only literal is a model name in an index's `WHERE`, validated by `MODEL_NAME` and quoted.
- **SSRF**: the site only calls the registered gateway at fixed paths (`LAB_PATHS`); the gateway rebuilds each call at fixed local paths; the development overrides (`MEMORY_OLLAMA_URL`, `MEMORY_MEM0_URL`) accept only `127.0.0.1`/`localhost` and are ignored on the live server.
- **Exports** are kept in the database for 72 hours and downloaded only by whoever made them; never a storage URL. CSV cells that start with `= + - @` are neutralized.

## Never exposed

Postgres, Ollama, Open WebUI and the Mem0 sidecar all listen on localhost or Render's private network. The only path from Render to the Mac is the existing Cloudflare tunnel with an Access service token, plus the HMAC `lab` signature. Mem0 telemetry is disabled in the sidecar. No secret reaches a browser: the Memory Manager calls the API with the session cookie.

## Defaults (System Settings)

Approval Required · PostgreSQL authoritative · Mem0 with native fallback · 10 memories / 2,048 tokens · weights 50/25/15/10 · automatic conflict resolution off · automatic fine-tuning off (can't be turned on) · customer capture off · external providers may not see private memory content · frontier fallback off.

## Before commercial enablement

1. Update the Privacy Policy (`src/lib/legal.ts`, bump its version): what is remembered, the Mac as a processor location, retention, the right to see and delete memories.
2. Add a user-facing switch and a "what RacingCoach remembers about me" view (the API and per-user helpers exist; the Account page UI doesn't yet).
3. Turn on customer capture only after both.
