CREATE TABLE github_settings (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 repository text, base_branch text NOT NULL DEFAULT 'main', revision integer NOT NULL DEFAULT 0
);
INSERT INTO github_settings(singleton) VALUES(true);
ALTER TABLE development_changes ADD COLUMN source jsonb;
CREATE TABLE github_publications (
 change_id uuid PRIMARY KEY REFERENCES development_changes(id),
 operation_id uuid NOT NULL UNIQUE,
 digest text NOT NULL, payload jsonb NOT NULL,
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','succeeded','failed')),
 result jsonb, error text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE harness_operations DROP CONSTRAINT harness_operations_kind_check;
ALTER TABLE harness_operations ADD CONSTRAINT harness_operations_kind_check CHECK(kind IN ('install','test','mission','github_publish'));
