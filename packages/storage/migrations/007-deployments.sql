CREATE TABLE release_settings (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 auto_enabled boolean NOT NULL DEFAULT false,
 policy_digest text,
 revision integer NOT NULL DEFAULT 0,
 maintenance boolean NOT NULL DEFAULT false,
 controller_seen_at timestamptz
);
INSERT INTO release_settings(singleton) VALUES(true);
CREATE TABLE deployments (
 id uuid PRIMARY KEY,
 change_id uuid NOT NULL REFERENCES development_changes(id),
 payload jsonb NOT NULL,
 state text NOT NULL DEFAULT 'preparing' CHECK(state IN ('preparing','awaiting_approval','queued','merging','merge_unknown','deploying','monitoring','succeeded','rollback_pending','rolled_back','rollback_failed','blocked','cancelled')),
 artifact jsonb,
 automatic boolean NOT NULL DEFAULT false,
 revision integer NOT NULL DEFAULT 0,
 merge_attempts integer NOT NULL DEFAULT 0,
 approved_at timestamptz,
 monitor_until timestamptz,
 error text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX one_active_deployment ON deployments((true)) WHERE state IN ('preparing','awaiting_approval','queued','merging','merge_unknown','deploying','monitoring','rollback_pending','rollback_failed');
CREATE INDEX deployments_change ON deployments(change_id,created_at DESC);
