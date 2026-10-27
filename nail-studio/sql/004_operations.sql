CREATE TABLE IF NOT EXISTS private.audit_log (
 id bigserial PRIMARY KEY,
 actor_id bigint NOT NULL,
 action text NOT NULL,
 entity_id text,
 before_data jsonb,
 after_data jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_created ON private.audit_log(created_at DESC, id DESC);
ALTER TABLE private.audit_log ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS private.worker_status (
 id integer PRIMARY KEY CHECK (id=1),
 finished_at timestamptz NOT NULL,
 delivered integer NOT NULL
);
ALTER TABLE private.worker_status ENABLE ROW LEVEL SECURITY;
