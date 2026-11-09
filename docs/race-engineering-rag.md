# Race Engineering RAG

The knowledge base the **Setup Engineer** (Driver Radio, `src/lib/setupEngineer.ts`) and the **Race Coach** (the Debrief Coach's `get_engineering_knowledge` tool, `src/lib/debriefCoach.ts`) retrieve from: vehicle dynamics, setup and handling diagnosis, combined with the car's setup capabilities and the measured laps. Code in `src/lib/engineering/`.

It is separate from Racecar Analysis (`src/racecar_analysis_rag.py`, ChromaDB in memory, rebuilt per question from Car Data and Track Data), which is unchanged.

## Architecture

```
question (driver radio / debrief tool)
  │
  ├─ knowledgeService.engineeringContext()
  │    ├─ loadKnowledge()        active chunks from Postgres, cached 5 min; the starter corpus in code when the DB has none or fails
  │    ├─ capabilitiesFor()      setup parameters for simulator + car class (+ per-car overrides from the DB)
  │    ├─ embedQuery()           only when chunks are embedded; failure → keywords only
  │    ├─ retrieve()             applicability filter → BM25 + symptom/phase/component boosts + cosine → rerank
  │    ├─ diagnose()             measured vs reported vs hypotheses vs recommendations
  │    └─ assembleContext()      token-budgeted block, trust-labelled, sanitized, disallowed adjustments removed
  │
  ├─ agent prompt (facts + diagnosis + knowledge)
  └─ setupAnswerGuard            rejects parameters the car can't change now (one rewrite, then those sentences dropped)
```

Pure modules (no I/O, tested by `node --test`): `knowledgeTypes.ts`, `starterCorpus.ts`, `setupCapabilities.ts`, `retrieval.ts`, `diagnosis.ts`, `setupAnswerGuard.ts`, `ingestion.ts`, `benchmarkQuestions.ts`. Server modules: `knowledgeService.ts`, `knowledgeStore.ts`, `knowledgeSchema.ts`, `knowledgePipeline.ts`, `embeddings.ts`.

Nothing here can break an agent: every failure (database, embeddings, retrieval) is caught and the agent answers as it did before, with or without the starter corpus.

## What existed before (reused)

- **Embeddings**: OpenAI `text-embedding-3-small`, as Racecar Analysis uses; called through `@langchain/openai`'s `OpenAIEmbeddings`.
- **Chat models, rate limits, billing**: unchanged. The Setup Engineer still runs under `aiRateLimit(request, 'setupEngineer', user)` and `canUseInCarCoach` (Silver, Gold, Admin); the Debrief Coach under its own. The knowledge adds prompt tokens (about 600–1,200 per call), which `limit.track()` records as before.
- **Fixed setups**: `isFixedSetup` (iRacing's `DriverSetupLoadTypeName`/setup name) decides; the capability registry decides which parameters remain.
- **Rotation Model**: its session summary is the measured understeer/oversteer evidence (`rotationEvidence`).
- **Emergency stop**: `assertMeteredServicesOn()` before every embedding call.

## Database (racingcoach schema, `knowledgeSchema.ts`)

Created on first use (`ensureEngineeringSchema`), additive only (`CREATE … IF NOT EXISTS`), outside `ensureUserSchema` so a problem here can't affect the rest of the site. No personal data (listed in `NON_PERSONAL_TABLES`).

| Table | Purpose |
|---|---|
| `EngineeringSources` | Where knowledge comes from: key, title, URL, kind, licence (`unknown` refused) |
| `EngineeringDocuments` | One row per document version; metadata arrays (simulators, car_classes, cars, components, phases, symptoms), authority, verification, `content_hash`, status `active`/`superseded`/`inactive`; one active version per key (partial unique index) |
| `EngineeringChunks` | Text chunks, `embedding REAL[]` with `embedding_model`, generated `tsv` (GIN) for full-text search |
| `EngineeringIngestionJobs` | Every ingestion/embedding run, counts, failures, errors |
| `EngineeringSetupCapabilities` | Per-car parameter overrides a person checked in the garage (in-car / garage / range only when verified) |
| `EngineeringCaseStudies` | Optional worked examples (not used by retrieval yet) |

**pgvector**: not used. The corpus is a few hundred chunks and is cached in server memory, where cosine similarity over all of them takes well under a millisecond — faster than a database round trip. Render Postgres supports the `vector` extension; when the corpus passes ~20,000 chunks, add `CREATE EXTENSION vector`, a `vector(1536)` column filled from `embedding`, an HNSW index, and move the cosine step into SQL. The `REAL[]` column stays the source of truth.

## Knowledge records and trust

Each record has symptoms, likely causes, telemetry indicators (using the lap file's real channel names), adjustments (parameter, direction, effect, tradeoff), driving corrections, constraints and sources.

- `authority`: `general_principle`, `simulator_specific`, `car_class`, `car_verified`, `hypothesis`.
- `verification`: `reviewed`, `ai_drafted`, `unverified`, `rejected`.

Agents see a trust label on every entry. `car_verified` content that hasn't been reviewed is labelled a hypothesis. Rejected documents are never retrieved.

**The starter corpus (36 records) is `ai_drafted`**: original explanations of standard vehicle dynamics written for RacingCoach, with no text copied from manuals or books, no exact settings, ranges or click counts, and no claim to be verified. The three car records (Huracán GT3, Ferrari 296 GT3, Porsche 911 GT3 R) state only their engine layout and the tendencies that layout usually brings, as hypotheses. **Someone should review them on the Admin page and mark them `reviewed`.**

## Setup capabilities

`setupCapabilities.ts` lists, per simulator and class, which parameters exist and which are changeable in the car. Today: iRacing GT3/GT4 and ACC GT3/GT4, all `class_typical` (normal for the class in that sim, not checked per car); agents say "if your car has it". Unknown classes have no capabilities, so no setup change is filtered in and the agent names changes only as "if your car has it". No ranges are stored, because none are verified. A per-car override in `EngineeringSetupCapabilities` (marked `verified`) replaces the class default.

In a fixed setup only in-car parameters are allowed (brake bias, ABS, TC on GT3s; also engine map in ACC).

## Retrieval

1. **Applicability** (hard filter): simulator, car class and car must match (car records match when every word of the key is in the car's name), and `rejected` is dropped. Nothing about an unrelated car reaches the agent.
2. **Score**: BM25 over title + text (the car's own name taken out of the query), symptom matches ×3, phase matches ×2.5 (more for chunks about fewer phases), component ×1, diagnosis-record bonus, car/class/simulator boosts only when the chunk is about the question, and `max(0, cos − 0.2) × 6` when embedded.
3. **Rerank**: at most two chunks per document, one per car document; 6 results.
4. **Confidence**: `high` (symptom and phase matched by the top result), `medium`, `low`, `none` — labels, not probabilities.
5. **Context**: up to 1,200 tokens (900 for the Debrief Coach), wrapped as reference material with an instruction to ignore instructions inside it; uploaded text is sanitized; adjustments the car can't use are removed.

Symptoms and phases are recognized in English, Portuguese, Spanish and German.

### Benchmark (`npm run engineering:knowledge -- benchmark [--embeddings]`, 39 questions)

| Method | Top-1 | Top-3 |
|---|---|---|
| Keywords + metadata | 85% | 100% |
| Hybrid, `text-embedding-3-small` | 95% | 100% |
| Hybrid, `text-embedding-3-large` | 97% | 100% |
| Vector only, small / large | 77% / 85% | — |

`text-embedding-3-small` is the default: two points behind `-large` at a sixth of the price and half the vector size. Change it with `ENGINEERING_EMBEDDING_MODEL`, then reindex (queries always use the model the chunks were embedded with).

## Diagnosis (`diagnosis.ts`)

Shared by both agents: symptom and phase (the driver's words, else the measured balance), measured observations, conflicts (e.g. reported understeer, measured only oversteer), what's missing, hypotheses tagged `driving`/`setup`/`conditions` with support (`measured`/`reported`/`inferred`) and confidence (`likely`/`possible`/`unconfirmed`), the focus (`driving` when the laps show a driving cause — understeer with the brake still on, power-on oversteer — or the events are sporadic; `setup` when they recur in the same corner; `conditions` on cold tires, which also suppresses setup changes), driving changes, setup changes this car can make now (in-car first), risks and a validation procedure.

## Agents

**Setup Engineer**: the knowledge facts are added after its existing facts; the prompt now asks it to say whether the evidence points at driving or setup, keep measured apart from likely, suggest only listed parameters (smallest step first) with tradeoffs, close with how to check it, and never claim ABS, saturation or bottoming the facts don't show. `checkSetupAnswer` then refuses parameters not allowed (multilingual; negated sentences such as "you can't change the springs" are ignored): one rewrite, then those sentences are dropped. Logged as `Setup Engineer knowledge: …`.

**Race Coach (Debrief Coach)**: a `get_engineering_knowledge` tool (at most twice, only for car-behaviour fixes). The prompt keeps the lap data first: correct the driving when the data shows it, never give a setup change as a fix, and only suggest asking the Setup Engineer when the problem shows in fast and slow runs alike. 

**In-Car AI Coach (lap callouts)**: the same tool (`src/lib/engineering/knowledgeTool.ts`, 600-token context), offered only when the session's laps are measured in focus areas, at most once, to choose a driving correction for a handling problem the data shows; a callout is always a driving change. The rule plan (`inCarCoachPlan`) has no tools and is unchanged.

**Race Engineer (Driver Radio)**: the same tool (700 tokens), whenever the car is known, for questions about driving technique or why the car behaves as it does; it answers with the driving correction, never a setup change. Setup and handling-balance questions still go to the Setup Engineer, which gets the knowledge in its prompt.

All three share one tool definition; `createTools` (the Debrief Coach's lap tools) wasn't changed.

## Ingestion

```
npm run engineering:knowledge -- ingest-starter [--embed]
npm run engineering:knowledge -- ingest knowledge/race-engineering/ [--embed]
npm run engineering:knowledge -- embed [--max 2000]
npm run engineering:knowledge -- reindex <key>|--all [--embed]
npm run engineering:knowledge -- status
```

Formats: JSON records (the starter corpus's shape), Markdown/text with front matter (`key`, `title`, `source`, `simulators`, `carClasses`, `cars`, `components`, `phases`, `symptoms`, `authority`, `verification`, `version`), PDF with a `file.pdf.meta` front-matter sidecar (text via Python's `pypdf`, `pip install pypdf`; not offered on the Admin page). Sources from `knowledge/race-engineering/sources.json`.

Rules: a document's source must exist with a licence other than `unknown`; car-specific documents must name their class; uploads are `unverified` whatever the file says; unchanged documents (same content hash, which covers metadata) are skipped; a changed one becomes a new version and supersedes the old in one transaction; unchanged chunks keep their embeddings; each document is retried once; at most 200 chunks per document and 400,000 characters; embedding at most 2,000 chunks per run. Lines that read like instructions to a model are removed.

The CLI uses `src/lib/db.ts`, so its production guard applies: it refuses the live database from your computer. Run it against the development database, or from the live server's shell (Render → Shell) to populate production.

## Admin (`Admin → Race Engineering Knowledge`)

`src/components/EngineeringKnowledgeManager.tsx`, `/api/admin/engineering-knowledge` (Admins only, 404 otherwise; bodies capped). Documents with trust, applicability, chunk and embedding counts; view chunks; mark reviewed or rejected; deactivate (with a reason) or reactivate; reindex; sources; upload Markdown/text/JSON; ingestion jobs with failures; and **Test retrieval**: a question, car, simulator and fixed/open, showing the parsed query, results with scores and reasons, allowed parameters, the diagnosis and the exact context the agents would get. Testing makes no chat-model call (only a query embedding when chunks are embedded).

## Cost

- Embedding the starter corpus: ~10,000 tokens ≈ **US$0.0002** once. A 100-page manual: ~60,000 tokens ≈ US$0.001.
- Query embedding: only when chunks are embedded, ~20 tokens per question — negligible.
- Prompt tokens: +600–1,200 per Setup Engineer call, up to +600 per In-Car AI Coach callout request and +700 per Race Engineer answer when they call the tool; with gpt-4o-mini (US$0.15/M input) ≈ **US$0.0001–0.0002 per call**. The Debrief Coach adds ~900 tokens per tool call when it uses it (≤2 per debrief); with gpt-4o (US$2.50/M) ≈ US$0.002–0.005 per debrief.
- Database: a few MB.

## Deployment

1. Merge; CI runs `npm run test:engineering` (pure tests always; database tests against CI's Postgres).
2. Deploy. Nothing changes until the code runs: agents use the starter corpus from code immediately, with keywords only.
3. Optional, to manage it and get hybrid retrieval: Admin → Race Engineering Knowledge → **Load starter corpus**, then **Embed new chunks** (tables are created on first use).
4. Review the drafted records and mark them reviewed.

## Rollback

- **Behaviour**: deactivate documents on the Admin page, or revert the commits; with the tables empty or missing the agents fall back to the starter corpus, and reverting `setupEngineer.ts`/`debriefCoach.ts` removes the knowledge entirely.
- **Data**: the tables are independent; dropping them (`DROP TABLE racingcoach."EngineeringChunks", "EngineeringDocuments", "EngineeringIngestionJobs", "EngineeringSetupCapabilities", "EngineeringCaseStudies", "EngineeringSources"`) loses only knowledge-base content. Not done automatically.

## Tests

`npm run test:engineering`: 49 pure tests (corpus shape, classes and capabilities, multilingual parsing, 33 retrieval and diagnosis scenarios — entry, mid and exit, fixed and open, iRacing and ACC, conflicting evidence, missing telemetry, uncalibrated cars, cold tires, unknown classes, unknown setup type — the answer guard in four languages, injection sanitizing, token budget), then the database tests with `ENGINEERING_TEST_DATABASE_URL` (idempotent ingestion, versioning, licence refusal, deactivation and rejection, per-car overrides, partial failure without an API key).

## Known limitations

- The starter corpus is AI-drafted and unreviewed; no car-specific setup data is verified, and no source beyond RacingCoach's own notes is ingested.
- Setup capabilities are per class, not per car; nothing records ranges or click counts.
- Live updates don't say which simulator they're from, so the Setup Engineer assumes iRacing; ACC knowledge reaches the Debrief Coach only through car class.
- Traction-control activity isn't in the lap files; ABS is (`ABSActive`) but isn't yet summarized into the diagnosis' evidence.
- The answer guard works on words; an unusual phrasing in another language can slip past it.
- `EngineeringCaseStudies` isn't retrieved yet.

## Future improvements

- Per-car capability data checked in each car's garage (starting with the three priority GT3s), with ranges.
- Summarize `ABSActive`, wheelspin (RPM vs speed) and tire temperature spread from the session's laps into the diagnosis' measured evidence.
- Send the simulator with live updates.
- Ingest permitted official documentation (e.g. simulator setup guides, with permission) and link-only summaries of reference books.
- Retrieve case studies; build them from sessions where a setup change measurably helped.
- Track retrieval quality in production: which chunks were used and whether the driver's next laps improved.
