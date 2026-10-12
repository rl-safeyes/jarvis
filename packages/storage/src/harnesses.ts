import { createHash } from 'node:crypto';
import { z } from 'zod';
import { DomainError, transaction, type Pool } from './index.ts';
import type { PoolClient } from 'pg';
import { agents } from '@jarvis/agent-registry';
import {
  accountSchema,
  profileSchema,
  type HarnessDashboard,
  type RuntimeSnapshot,
} from '../../contracts/src/harnesses.ts';
export const catalog = [
  { id: 'codex', name: 'Codex', version: '0.161.0', auth_methods: ['device', 'api_key'] },
  {
    id: 'claude-code',
    name: 'Claude Code',
    version: '2.1.296',
    auth_methods: ['claude_subscription', 'api_key'],
  },
  { id: 'opencode', name: 'OpenCode', version: '1.18.35', auth_methods: ['api_key'] },
] as const;
export const fingerprint = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export class HarnessRepository {
  constructor(readonly pool: Pool) {}
  async seed() {
    for (const h of catalog)
      await this.pool.query(
        'INSERT INTO harness_installations(id,version) VALUES($1,$2) ON CONFLICT DO NOTHING',
        [h.id, h.version],
      );
    for (const a of agents) {
      await this.pool.query(
        'INSERT INTO agent_configs(id,instructions) VALUES($1,$2) ON CONFLICT DO NOTHING',
        [
          a.id,
          `${a.description} Réponds en français. Cette version permet uniquement de converser, sans outils ni exécution de code.`,
        ],
      );
      await this.pool.query(
        'INSERT INTO agent_registry(id,name,department_id,description) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',
        [a.id, a.name, a.department_id, a.description],
      );
    }
  }
  async dashboard(): Promise<HarnessDashboard> {
    return transaction(this.pool, async (c) => {
      await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const installations = (await c.query('SELECT * FROM harness_installations ORDER BY id')).rows;
      const settings = (await c.query('SELECT default_profile_id,revision FROM runtime_settings'))
        .rows[0];
      return {
        harnesses: installations.map((h) => ({ ...h, ...catalog.find((x) => x.id === h.id) })),
        accounts: (
          await c.query(
            'SELECT id,name,harness,state,revision FROM harness_accounts ORDER BY created_at',
          )
        ).rows,
        profiles: (
          await c.query(`SELECT p.id,p.name,p.account_id,p.model,a.harness,
          CASE WHEN a.state='ready' AND p.tested_revision=a.revision AND h.state='installed' THEN p.state ELSE 'untested' END AS state
          FROM execution_profiles p JOIN harness_accounts a ON a.id=p.account_id JOIN harness_installations h ON h.id=a.harness ORDER BY p.created_at`)
        ).rows,
        settings,
        agents: (
          await c.query(
            'SELECT *,COALESCE(profile_id,$1) AS effective_profile_id FROM agent_configs ORDER BY id',
            [settings.default_profile_id],
          )
        ).rows,
        operations: (
          await c.query(
            'SELECT id,kind,state,error,result FROM harness_operations ORDER BY created_at DESC LIMIT 30',
          )
        ).rows,
      };
    });
  }
  async account(id: string) {
    const a = (await this.pool.query('SELECT * FROM harness_accounts WHERE id=$1', [id])).rows[0];
    if (!a) throw new DomainError(404, 'account_missing', 'Compte introuvable.');
    return a;
  }
  async createAccount(input: z.infer<typeof accountSchema>) {
    await this.pool.query(
      'INSERT INTO harness_accounts(id,name,harness) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
      [input.id, input.name, input.harness],
    );
    const a = await this.account(input.id);
    if (a.name !== input.name || a.harness !== input.harness)
      throw new DomainError(409, 'idempotency_conflict', 'Identifiant de compte déjà utilisé.');
    return a;
  }
  async createProfile(input: z.infer<typeof profileSchema>) {
    await this.account(input.account_id);
    await this.pool.query(
      'INSERT INTO execution_profiles(id,name,account_id,model) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',
      [input.id, input.name, input.account_id, input.model],
    );
    const p = (await this.pool.query('SELECT * FROM execution_profiles WHERE id=$1', [input.id]))
      .rows[0];
    if (p.name !== input.name || p.account_id !== input.account_id || p.model !== input.model)
      throw new DomainError(409, 'idempotency_conflict', 'Identifiant de profil déjà utilisé.');
    return p;
  }
  async setDefault(profileId: string | null, revision: number) {
    return transaction(this.pool, async (c) => {
      const s = (await c.query('SELECT * FROM runtime_settings FOR UPDATE')).rows[0];
      if (s.revision !== revision)
        throw new DomainError(
          409,
          'version_conflict',
          'Le défaut a changé. Actualisez les réglages.',
        );
      if (profileId) await this.profile(c, profileId, true);
      await c.query('UPDATE runtime_settings SET default_profile_id=$1,revision=revision+1', [
        profileId,
      ]);
    });
  }
  async setAgent(id: string, instructions: string, profileId: string | null, revision: number) {
    return transaction(this.pool, async (c) => {
      const a = (await c.query('SELECT * FROM agent_configs WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!a) throw new DomainError(404, 'agent_missing', 'Agent introuvable.');
      if (a.revision !== revision)
        throw new DomainError(409, 'version_conflict', 'La fiche a changé. Actualisez-la.');
      if (profileId) await this.profile(c, profileId, true);
      await c.query(
        'INSERT INTO agent_config_history VALUES($1,$2,$3,$4,now()) ON CONFLICT DO NOTHING',
        [id, a.revision, a.instructions, a.profile_id],
      );
      await c.query(
        'UPDATE agent_configs SET instructions=$2,profile_id=$3,revision=revision+1 WHERE id=$1',
        [id, instructions, profileId],
      );
    });
  }
  async profile(c: PoolClient, id: string, ready: boolean) {
    const p = (
      await c.query(
        `SELECT p.*,a.harness,a.revision AS account_revision,a.state AS account_state,h.version AS harness_version,h.image_digest,h.state AS installation_state
      FROM execution_profiles p JOIN harness_accounts a ON a.id=p.account_id JOIN harness_installations h ON h.id=a.harness WHERE p.id=$1 FOR SHARE OF p,a,h`,
        [id],
      )
    ).rows[0];
    if (!p) throw new DomainError(404, 'profile_missing', 'Profil introuvable.');
    if (
      p.installation_state !== 'installed' ||
      p.account_state !== 'ready' ||
      (ready && (p.state !== 'ready' || p.tested_revision !== p.account_revision))
    )
      throw new DomainError(
        409,
        'profile_not_ready',
        'Connectez le compte puis testez ce profil dans les réglages.',
      );
    return p;
  }
  async resolve(c: PoolClient, agentId = 'direction.jarvis'): Promise<RuntimeSnapshot> {
    const s = (await c.query('SELECT * FROM runtime_settings FOR SHARE')).rows[0];
    const a = (await c.query('SELECT * FROM agent_configs WHERE id=$1 FOR SHARE', [agentId]))
      .rows[0];
    if (!a) throw new DomainError(404, 'agent_missing', 'Agent introuvable.');
    const id = a.profile_id ?? s.default_profile_id;
    if (!id)
      throw new DomainError(
        409,
        'setup_required',
        'Connectez et testez un harness, puis choisissez le défaut dans les réglages.',
      );
    const p = await this.profile(c, id, true);
    return {
      profile_id: id,
      account_id: p.account_id,
      account_revision: p.account_revision,
      model: p.model,
      harness: p.harness,
      harness_version: p.harness_version,
      image_digest: p.image_digest,
      source: a.profile_id ? 'agent' : 'default',
      default_revision: a.profile_id ? null : s.revision,
      agent_id: agentId,
      agent_revision: a.revision,
      instructions: a.instructions,
    };
  }
  async operation(
    id: string,
    kind: 'install' | 'test' | 'mission',
    payload: Record<string, unknown>,
    client?: PoolClient,
  ) {
    const c = client ?? this.pool;
    const hash = fingerprint({ kind, payload });
    await c.query(
      'INSERT INTO harness_operations(id,kind,request_hash,payload) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',
      [id, kind, hash, payload],
    );
    const op = (await c.query('SELECT * FROM harness_operations WHERE id=$1', [id])).rows[0];
    if (op.request_hash !== hash)
      throw new DomainError(
        409,
        'idempotency_conflict',
        'Cette opération correspond déjà à une autre demande.',
      );
    return op;
  }
  async test(id: string, profileId: string) {
    return transaction(this.pool, async (c) => {
      const existing = (await c.query('SELECT * FROM harness_operations WHERE id=$1', [id]))
        .rows[0];
      if (existing) {
        if (existing.kind !== 'test' || existing.payload.profile_id !== profileId)
          throw new DomainError(409, 'idempotency_conflict', 'Opération déjà utilisée.');
        return existing;
      }
      const p = await this.profile(c, profileId, false);
      return this.operation(
        id,
        'test',
        {
          profile_id: profileId,
          account_id: p.account_id,
          harness: p.harness,
          model: p.model,
          account_revision: p.account_revision,
          image_digest: p.image_digest,
        },
        c,
      );
    });
  }
}
