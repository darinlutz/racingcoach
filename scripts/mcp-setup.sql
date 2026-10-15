-- Run as database owner BEFORE configuring MCP_DATABASE_URL.
-- Do not use the application's general-purpose database credentials for MCP.
BEGIN;
CREATE TABLE IF NOT EXISTS racingcoach."McpAuditLog" (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_subject text NOT NULL,
  action text NOT NULL,
  track_id integer,
  details jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Replace role/password using a secure secret manager; do not commit passwords.
-- CREATE ROLE racingcoach_mcp LOGIN PASSWORD '<generated-secret>';
-- GRANT USAGE ON SCHEMA racingcoach TO racingcoach_mcp;
-- GRANT SELECT, INSERT ON racingcoach."Tracks" TO racingcoach_mcp;
-- GRANT USAGE ON SEQUENCE racingcoach."Tracks_id_seq" TO racingcoach_mcp;
-- GRANT INSERT ON racingcoach."McpAuditLog" TO racingcoach_mcp;
-- GRANT USAGE ON SEQUENCE racingcoach."McpAuditLog_id_seq" TO racingcoach_mcp;
COMMIT;
