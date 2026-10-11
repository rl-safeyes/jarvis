import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { DomainError, transaction, type Pool } from './index.ts';
import { HarnessRepository, fingerprint } from './harnesses.ts';
import { createAgentSchema, type CreateAgent } from '../../contracts/src/agents.ts';

export const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 45);
export class AgentRepository {
  constructor(readonly pool: Pool) {}
  async catalogue(c: PoolClient | Pool = this.pool) {
    const agents = (
      await c.query(`SELECT r.*,a.instructions,a.revision,a.profile_id,
      COALESCE(a.profile_id,s.default_profile_id) AS effective_profile_id,
      CASE WHEN p.state='ready' AND p.tested_revision=h.revision AND h.state='ready' AND i.state='installed' THEN 'ready' ELSE 'planned' END AS status,
      '[]'::jsonb AS tools
      FROM agent_registry r JOIN agent_configs a USING(id) CROSS JOIN runtime_settings s
      LEFT JOIN execution_profiles p ON p.id=COALESCE(a.profile_id,s.default_profile_id)
      LEFT JOIN harness_accounts h ON h.id=p.account_id LEFT JOIN harness_installations i ON i.id=h.harness ORDER BY r.created_at,r.id`)
    ).rows;
    return {
      agents,
      departments: (await c.query('SELECT * FROM departments ORDER BY created_at,id')).rows,
    };
  }
  async create(requestId: string, input: CreateAgent, client?: PoolClient) {
    const work = async (c: PoolClient) => {
      const data = createAgentSchema.parse(input);
      const digest = fingerprint(data);
      // Serialize creation/name checks, including retries of the same orchestration step.
      await c.query('SELECT pg_advisory_xact_lock(74638105)');
      const previous = (
        await c.query('SELECT * FROM agent_creations WHERE request_id=$1', [requestId])
      ).rows[0];
      if (previous) {
        if (previous.request_hash !== digest)
          throw new DomainError(
            409,
            'idempotency_conflict',
            'Création déjà utilisée pour une autre fiche.',
          );
        return (await c.query('SELECT * FROM agent_registry WHERE id=$1', [previous.agent_id]))
          .rows[0];
      }
      if (data.profile_id) await new HarnessRepository(this.pool).profile(c, data.profile_id, true);
      const departmentSlug = slug(data.department);
      const agentSlug = slug(data.name);
      if (!/^[a-z]/.test(departmentSlug) || !/^[a-z]/.test(agentSlug))
        throw new DomainError(
          400,
          'invalid_name',
          'Utilisez un nom contenant des lettres latines.',
        );
      const departments = (await c.query('SELECT * FROM departments')).rows;
      const department = departments.find(
        (d) => d.id === data.department || slug(d.name) === departmentSlug,
      );
      const departmentId = department?.id ?? departmentSlug;
      const id = `${departmentId}.${agentSlug}`;
      if ((await c.query('SELECT id FROM agent_configs WHERE id=$1', [id])).rowCount)
        throw new DomainError(
          409,
          'agent_exists',
          `Un agent ${id} existe déjà. Utilisez sa fiche existante.`,
        );
      if (Number((await c.query('SELECT count(*) FROM agent_registry')).rows[0].count) >= 100)
        throw new DomainError(409, 'agent_limit', 'La limite de 100 agents est atteinte.');
      if (!department)
        await c.query('INSERT INTO departments(id,name) VALUES($1,$2)', [
          departmentId,
          data.department,
        ]);
      await c.query('INSERT INTO agent_configs(id,instructions,profile_id) VALUES($1,$2,$3)', [
        id,
        data.instructions,
        data.profile_id,
      ]);
      const agent = (
        await c.query(
          'INSERT INTO agent_registry(id,name,department_id,description) VALUES($1,$2,$3,$4) RETURNING *',
          [id, data.name, departmentId, data.description],
        )
      ).rows[0];
      await c.query('INSERT INTO agent_creations VALUES($1,$2,$3)', [requestId, digest, id]);
      return agent;
    };
    return client ? work(client) : transaction(this.pool, work);
  }
  async versions(id: string) {
    const a = (
      await this.pool.query(
        'SELECT id AS agent_id,revision,instructions,profile_id FROM agent_configs WHERE id=$1',
        [id],
      )
    ).rows[0];
    if (!a) throw new DomainError(404, 'agent_missing', 'Agent introuvable.');
    return {
      versions: [
        a,
        ...(
          await this.pool.query(
            'SELECT agent_id,revision,instructions,profile_id FROM agent_config_history WHERE agent_id=$1 ORDER BY revision DESC',
            [id],
          )
        ).rows,
      ],
    };
  }
}
export async function missionEvent(
  c: PoolClient,
  id: string,
  type: string,
  message: string,
  extra: Record<string, unknown> = {},
) {
  await c.query(
    `INSERT INTO mission_events(event_id,mission_id,sequence,type,payload)
    SELECT $1,$2,COALESCE(MAX(sequence),0)+1,$3,$4 FROM mission_events WHERE mission_id=$2`,
    [randomUUID(), id, type, { message, simulated: false, ...extra }],
  );
}
