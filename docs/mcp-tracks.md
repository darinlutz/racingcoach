# RacingCoach Tracks MCP (review-only integration)

This is a **draft** OAuth-protected, append-only MCP endpoint for ChatGPT. Do not deploy until an OAuth provider, restricted PostgreSQL role, and audit table are configured and the implementation is tested.

## Environment variables (Render secrets; never commit values)
- `MCP_OAUTH_ISSUER`: exact issuer URL of an OAuth authorization server that supports ChatGPT OAuth login.
- `MCP_JWKS_URL`: HTTPS JWKS URL from that issuer; access tokens must be RS256 JWTs.
- `MCP_OAUTH_AUDIENCE`: exact audience in access tokens.
- `MCP_ALLOWED_SUBJECT`: your admin account's exact immutable OAuth subject.
- `MCP_RESOURCE_URL`: `https://racingcoach.onrender.com/api/mcp`.
- `MCP_DATABASE_URL`: connection string for a **separate least-privilege** PostgreSQL role.

OAuth provider must publish discovery metadata and support authorization code + PKCE, registration compatible with ChatGPT's custom MCP app setup, and request scopes `tracks:read` / `tracks:write`. Do not reuse RacingCoach login cookies or the existing general-purpose DATABASE_URL.

## Database provisioning
Run `scripts/mcp-setup.sql` using an administrative connection. Create a dedicated DB role, then grant only schema usage, SELECT/INSERT on Tracks, INSERT on McpAuditLog, and sequence usage. Inspect actual sequence names before running the commented example GRANTs. Keep credentials in Render environment variables. The endpoint fails closed if settings are missing.

## Testing and rollout
1. Test locally with a dedicated OAuth issuer/test user and isolated test database.
2. Verify missing/expired/wrong-audience JWTs fail; unauthorized subjects fail; missing write scope fails.
3. Verify list_tracks, get_track, insert_track, duplicate-key rejection, and audit log.
4. Verify SQL injection strings remain data, and write errors roll back both track and audit entries.
5. Configure ChatGPT custom MCP app URL and OAuth connection only after tests pass.
6. Keep branch as a draft PR until reviewed; **do not merge to main** until OAuth and database roles are configured.

## Caveats
- This implements JSON-RPC POST for core MCP tools; test transport compatibility with the current ChatGPT MCP client before production. Streaming GET is intentionally not implemented.
- `MCP_ALLOWED_SUBJECT` restricts to one administrator. OAuth provider policies must also restrict access.
- ChatGPT write confirmation is a client-side UX safeguard, not a server-enforced second approval. If mandatory server-side confirmation is required, add a two-phase approval workflow before enabling insert_track.
- No arbitrary SQL tool is exposed; no UPDATE/DELETE tools are implemented.
