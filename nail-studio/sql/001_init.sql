-- Private schema is not exposed via Supabase REST. All writes run through the server.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
CREATE TABLE IF NOT EXISTS private.studio(id integer PRIMARY KEY CHECK(id=1),data jsonb NOT NULL,version integer NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS private.outbox(id bigserial PRIMARY KEY,dedupe text UNIQUE NOT NULL,chat_id bigint NOT NULL,booking_id bigint,revision integer,payload jsonb NOT NULL,due_at timestamptz NOT NULL,expires_at timestamptz,attempts integer NOT NULL DEFAULT 0,lease_until timestamptz,sent_at timestamptz,dead boolean NOT NULL DEFAULT false,last_error text);
CREATE INDEX IF NOT EXISTS outbox_due ON private.outbox(due_at) WHERE sent_at IS NULL AND NOT dead;
CREATE TABLE IF NOT EXISTS private.bot_updates(id bigint PRIMARY KEY,created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE private.studio ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.bot_updates ENABLE ROW LEVEL SECURITY;
-- No client roles receive grants or policies. Use the server database role only.
