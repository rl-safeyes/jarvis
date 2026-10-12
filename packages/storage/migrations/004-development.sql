ALTER TABLE missions ADD COLUMN development_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE mission_steps DROP CONSTRAINT mission_steps_kind_check;
ALTER TABLE mission_steps ADD CONSTRAINT mission_steps_kind_check CHECK(kind IN ('orchestrator','delegate','create_agent','developer','reviewer'));
CREATE TABLE development_changes (
 id uuid PRIMARY KEY, mission_id uuid NOT NULL UNIQUE REFERENCES missions(id),
 task text NOT NULL, developer_id text NOT NULL REFERENCES agent_registry(id), reviewer_id text NOT NULL REFERENCES agent_registry(id),
 image_digest text NOT NULL,
 status text NOT NULL DEFAULT 'working' CHECK(status IN ('working','validating','reviewing','proposed','tests_failed','changes_requested','failed','cancelled')),
 artifact jsonb, validation jsonb, review jsonb, error text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE development_operations (
 id uuid PRIMARY KEY, change_id uuid NOT NULL REFERENCES development_changes(id), sequence integer NOT NULL,
 input jsonb NOT NULL, status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','succeeded','failed','cancelled')),
 result jsonb, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(change_id,sequence)
);
