CREATE TABLE harness_installations (
  id text PRIMARY KEY, version text NOT NULL, state text NOT NULL DEFAULT 'absent',
  image_digest text, error text, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE harness_accounts (
  id uuid PRIMARY KEY, name text NOT NULL, harness text NOT NULL REFERENCES harness_installations(id),
  state text NOT NULL DEFAULT 'disconnected', revision integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE execution_profiles (
  id uuid PRIMARY KEY, name text NOT NULL, account_id uuid NOT NULL REFERENCES harness_accounts(id),
  model text NOT NULL, state text NOT NULL DEFAULT 'untested', tested_revision integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE runtime_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  default_profile_id uuid REFERENCES execution_profiles(id), revision integer NOT NULL DEFAULT 0
);
INSERT INTO runtime_settings(singleton) VALUES (true);
CREATE TABLE agent_configs (
  id text PRIMARY KEY, instructions text NOT NULL, profile_id uuid REFERENCES execution_profiles(id),
  revision integer NOT NULL DEFAULT 0
);
CREATE TABLE agent_config_history (
  agent_id text NOT NULL, revision integer NOT NULL, instructions text NOT NULL,
  profile_id uuid, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(agent_id,revision)
);
CREATE TABLE harness_operations (
  id uuid PRIMARY KEY, kind text NOT NULL CHECK(kind IN ('install','test','mission')),
  request_hash text NOT NULL, payload jsonb NOT NULL, state text NOT NULL DEFAULT 'queued',
  result jsonb, error text, dispatched boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE missions DROP CONSTRAINT missions_harness_check;
ALTER TABLE missions ADD COLUMN runtime jsonb;
ALTER TABLE missions DROP CONSTRAINT missions_status_check;
ALTER TABLE missions ADD CONSTRAINT missions_status_check CHECK(status IN ('queued','running','cancel_requested','succeeded','failed','cancelled'));
