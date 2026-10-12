CREATE TABLE release_checks (
 id bigserial PRIMARY KEY,
 change_id uuid NOT NULL REFERENCES development_changes(id),
 started_at timestamptz NOT NULL,
 binding text NOT NULL,
 report jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX release_checks_change_started ON release_checks(change_id,started_at DESC);
