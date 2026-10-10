CREATE TABLE IF NOT EXISTS app_sessions (
  token_hash text PRIMARY KEY,
  csrf_token text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY,
  client_id uuid NOT NULL UNIQUE,
  creation_hash text NOT NULL,
  title text NOT NULL,
  version integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS missions (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES conversations(id),
  input text NOT NULL,
  status text NOT NULL CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
  harness text NOT NULL DEFAULT 'mock' CHECK (harness = 'mock'),
  agent_id text NOT NULL DEFAULT 'direction.jarvis',
  attempt integer NOT NULL DEFAULT 0,
  lease_token uuid,
  lease_until timestamptz,
  result text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS missions_claim ON missions(status, lease_until, created_at);
CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY,
  position bigserial UNIQUE,
  conversation_id uuid NOT NULL REFERENCES conversations(id),
  mission_id uuid NOT NULL REFERENCES missions(id),
  client_message_id uuid,
  request_hash text,
  role text NOT NULL CHECK (role IN ('user','assistant')),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, client_message_id),
  UNIQUE (mission_id, role)
);
CREATE INDEX IF NOT EXISTS messages_conversation ON messages(conversation_id, position);
CREATE TABLE IF NOT EXISTS mission_events (
  event_id uuid PRIMARY KEY,
  mission_id uuid NOT NULL REFERENCES missions(id),
  sequence integer NOT NULL,
  type text NOT NULL,
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (mission_id, sequence)
);
