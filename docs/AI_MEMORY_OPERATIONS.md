# Clarivex Memory Service: operations

## Jobs

`ai_memory."MemoryJobs"` is the queue. On the live server the worker claims jobs every 5 s (`FOR UPDATE SKIP LOCKED`, `jobConcurrency` at a time); on a development server an Admin action or the API runs a small batch right away (`kickJobs`), and Jobs > Run jobs now runs one.

| Type | Does | When |
|---|---|---|
| `extract` | the extraction pipeline | `/extract`, Open WebUI's filter, `proposeForUser` |
| `embed` | embeds a memory's current version | every create or text change |
| `reembed` | embeds everything with a target model, 32 at a time | Re-embed everything, Start migration |
| `sync` | sends the outbox to Mem0 | every sync interval (15 min) and Sync |
| `reconcile` | Mem0 against Postgres | daily and Reconcile |
| `cleanup` | lifecycle (below) | hourly and Run cleanup |
| `import` | imports over 100 rows | Import |

Statuses: Pending, Running, Completed, Failed, Deferred, Cancelled. Failures retry with backoff (30 s, 1, 2, 4… minutes, at most an hour) up to the retry limit, then **Failed (dead letter)**. An offline provider **defers** a job without using an attempt (up to 7 days); a busy Mac defers it 30 s. Jobs left Running by a stopped server return to Pending after 10 minutes. Every handler is idempotent: an embed job for an old version or a deleted memory does nothing; sync never writes a memory that isn't Active in Postgres now.

## Synchronization (Mem0)

Each memory change writes an outbox row (`MemoryProviderSync`) in the same transaction, so Mem0 never misses a change and never sees one that was rolled back. The sync job applies them in order, reading the memory's *current* state (not the event's): Active → upsert (the sidecar replaces that memory's old copy); anything else, or gone, or tombstoned → delete. `MemoryProviderRecords` maps memory IDs to Mem0's. Reconciliation lists Mem0's index, deletes anything not Active in Postgres, and queues upserts for anything missing or older. Mem0's index can be deleted at any time and rebuilt this way.

## Lifecycle (cleanup)

- Active memories past `expires_at` become **Expired** (with history). They're already out of retrieval the moment they expire.
- Soft-deleted memories past the deleted-retention period (30 days) are **permanently deleted**.
- Embeddings of older versions (kept a day for quick restores) are removed.
- Access log rows > 180 days, decided candidates > 180 days, done outbox rows > 30 days, finished jobs > 30 days, audit > 1 year, and expired exports are removed.
- Verification reminders: Active memories of importance ≥ 7 not verified in 180 days are counted (Overview, the detail drawer's "Not verified" badge).

Category retention defaults: Episodic 90 days, Temporary 14 days, Feedback 180 days (configurable); the rest last until changed, superseded, completed or deleted. A memory's own expiry date overrides its category's.

## Deletion

- **Delete**: status Deleted, out of retrieval, Mem0 copy removed; recoverable until the purge.
- **Delete permanently** (and every privacy deletion): the row and everything derived from it (history, embeddings, relationships, feedback, conflicts) in one transaction, a tombstone (ID and content hash only), queued jobs for it cancelled, its ID scrubbed from the access log and evaluation cases, and an outbox delete to every provider that ever held it. Nothing automated (sync, jobs, import, migration) can bring it back. A person typing the same text again may.
- **Delete Account**: see [security](AI_MEMORY_SECURITY.md#per-user-memory).

## Embedding migration

To change the embedding model without a gap:

1. Pull the new model on the Mac.
2. Jobs > Embedding migration > target model > **Start migration**. Every memory is embedded with it in the background, and its HNSW index is built; retrieval keeps using the current model.
3. When it shows N of N embedded, **Switch retrieval to …**. The switch is refused while coverage is incomplete.
4. Old embeddings stay (rollback = switch back), so nothing is ever compared across models.

## Backup and restore

- **Postgres**: Render's daily backups include `ai_memory`. For a separate copy: `pg_dump --schema=ai_memory --format=custom "$DATABASE_URL" > ai_memory-$(date +%F).dump`, stored encrypted (e.g. `gpg -c`).
- **Restore**: `pg_restore --schema=ai_memory --clean -d "$DATABASE_URL" ai_memory-….dump`. Then **Jobs > Run cleanup** and **Reconcile**. Deletions made after the backup: re-run the site's privacy ledger re-application (`reapplyErasures` at server start covers deleted accounts); for single memories deleted after the backup, delete them again (their tombstones are in the newer data you'd be replacing, so note them before restoring). Restoring never widens access: namespaces, owners and keys come back exactly as they were.
- **Mem0 / Qdrant** (`~/.racingcoach/mem0`): not backed up; it's rebuilt from Postgres with Reconcile.
- **Open WebUI**: `local-ai/openwebui/backup.sh` / `restore.sh`.

## Monitoring

Memory Manager > Overview (service health, queue, index coverage), Jobs (failures and dead letters), Analytics, Audit History. Errors go through `console.error`, so the site's error monitor emails new kinds. Frontier usage (only if allowed) is in Admin > AI usage as `memoryProcessing` and counts toward the spend monitor.

## Rollback of the whole feature

The schema is separate and additive: turning memory off (System Settings > Memory enabled) stops all retrieval and storage at once. To remove it entirely, revoke the API keys, turn the Open WebUI filter off, stop the Mem0 sidecar, and `DROP SCHEMA ai_memory CASCADE` after an export.
