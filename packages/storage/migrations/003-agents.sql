CREATE TABLE departments (
  id text PRIMARY KEY, name text NOT NULL, description text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO departments(id,name,description) VALUES
 ('direction','Direction','Comprendre les demandes et coordonner les missions.'),
 ('engineering','Ingénierie','Concevoir et développer de nouvelles capacités.'),
 ('quality','Qualité','Vérifier les résultats et prévenir les régressions.'),
 ('knowledge','Connaissance','Organiser les sources et les connaissances.');
CREATE TABLE agent_registry (
  id text PRIMARY KEY REFERENCES agent_configs(id),
  name text NOT NULL, department_id text NOT NULL REFERENCES departments(id),
  description text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO agent_registry(id,name,department_id,description)
 SELECT id, CASE id WHEN 'direction.jarvis' THEN 'Jarvis' WHEN 'engineering.developer' THEN 'Développeur' WHEN 'quality.reviewer' THEN 'Reviewer' ELSE 'Documentaliste' END,
 split_part(id,'.',1), instructions FROM agent_configs
 WHERE id IN ('direction.jarvis','engineering.developer','quality.reviewer','knowledge.researcher');
CREATE TABLE agent_creations (
 request_id uuid PRIMARY KEY, request_hash text NOT NULL, agent_id text NOT NULL REFERENCES agent_registry(id)
);
ALTER TABLE missions ADD COLUMN orchestration_version integer NOT NULL DEFAULT 0;
ALTER TABLE missions ADD COLUMN deadline_at timestamptz;
CREATE TABLE mission_steps (
 id uuid PRIMARY KEY, mission_id uuid NOT NULL REFERENCES missions(id), sequence integer NOT NULL,
 kind text NOT NULL CHECK(kind IN ('orchestrator','delegate','create_agent')),
 agent_id text NOT NULL, agent_name text NOT NULL, runtime jsonb,
 prompt text NOT NULL, status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','succeeded','failed','cancelled')),
 result text, error text, started_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(mission_id,sequence)
);
CREATE INDEX mission_steps_mission ON mission_steps(mission_id,sequence);
