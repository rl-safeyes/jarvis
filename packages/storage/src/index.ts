import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { HarnessRepository } from './harnesses.ts';
import { managementIntent, manage } from './management.ts';
import { Pool, type PoolClient } from 'pg';
import type {
  Conversation,
  ConversationDetail,
  Message,
  Mission,
  MissionEvent,
  SubmitMessage,
} from '@jarvis/contracts';
export { Pool } from 'pg';

export class DomainError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
type Row = Record<string, any>;
const date = (value: Date | string) => new Date(value).toISOString();
function conversation(row: Row): Conversation {
  return { id: row.id, title: row.title, version: row.version, created_at: date(row.created_at) };
}
function mission(row: Row): Mission {
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    input: row.input,
    status: row.status,
    harness: row.harness,
    agent_id: row.agent_id,
    attempt: row.attempt,
    result: row.result,
    runtime: row.runtime ?? null,
    created_at: date(row.created_at),
    updated_at: date(row.updated_at),
  };
}
function message(row: Row): Message {
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    mission_id: row.mission_id,
    role: row.role,
    content: row.content,
    created_at: date(row.created_at),
  };
}

export async function transaction<T>(
  pool: Pool,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function migrate(pool: Pool): Promise<void> {
  await transaction(pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(74638104)');
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    for (const version of ['001-foundation', '002-harnesses', '003-agents']) {
      if (
        (await client.query('SELECT version FROM schema_migrations WHERE version=$1', [version]))
          .rowCount
      )
        continue;
      await client.query(
        await readFile(new URL(`../migrations/${version}.sql`, import.meta.url), 'utf8'),
      );
      await client.query('INSERT INTO schema_migrations(version) VALUES($1)', [version]);
    }
  });
}

/** Caller holds the mission row lock, so the sequence is serialized per mission. */
async function appendEvent(
  client: PoolClient,
  id: string,
  type: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `INSERT INTO mission_events(event_id,mission_id,sequence,type,payload)
    SELECT $1,$2,COALESCE(MAX(sequence),0)+1,$3,$4 FROM mission_events WHERE mission_id=$2`,
    [randomUUID(), id, type, JSON.stringify(payload)],
  );
}

export interface Claim {
  mission: Mission;
  leaseToken: string;
}
export class Repository {
  constructor(
    readonly pool: Pool,
    readonly mode: 'mock' | 'live' = 'mock',
  ) {}

  async createConversation(clientId: string, title: string): Promise<Conversation> {
    return transaction(this.pool, async (client) => {
      const inputHash = hash({ title });
      await client.query(
        'INSERT INTO conversations(id,client_id,title,creation_hash) VALUES ($1,$2,$3,$4) ON CONFLICT (client_id) DO NOTHING',
        [randomUUID(), clientId, title, inputHash],
      );
      const row = (await client.query('SELECT * FROM conversations WHERE client_id=$1', [clientId]))
        .rows[0]!;
      if (row.creation_hash !== inputHash)
        throw new DomainError(
          409,
          'idempotency_conflict',
          'Cet identifiant correspond déjà à une autre conversation.',
        );
      return conversation(row);
    });
  }
  async listConversations(): Promise<Conversation[]> {
    return (
      await this.pool.query('SELECT * FROM conversations ORDER BY created_at DESC LIMIT 100')
    ).rows.map(conversation);
  }
  async detail(id: string): Promise<ConversationDetail> {
    // A consistent snapshot keeps the version and messages in sync while a worker completes.
    return transaction(this.pool, async (client) => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const row = (await client.query('SELECT * FROM conversations WHERE id=$1', [id])).rows[0];
      if (!row) throw new DomainError(404, 'not_found', 'Conversation introuvable.');
      const messages = (
        await client.query('SELECT * FROM messages WHERE conversation_id=$1 ORDER BY position', [
          id,
        ])
      ).rows.map(message);
      const missions = (
        await client.query('SELECT * FROM missions WHERE conversation_id=$1 ORDER BY created_at', [
          id,
        ])
      ).rows.map(mission);
      const tasks = (
        await client.query(
          `SELECT s.id,s.mission_id,s.sequence,s.kind,s.agent_id,s.agent_name,s.status,s.result,s.error,
        s.runtime->>'harness' AS harness,s.runtime->>'model' AS model,(s.runtime->>'agent_revision')::int AS agent_revision
        FROM mission_steps s JOIN missions m ON m.id=s.mission_id WHERE m.conversation_id=$1 ORDER BY s.created_at,s.sequence`,
          [id],
        )
      ).rows;
      return { conversation: conversation(row), messages, missions, tasks };
    });
  }
  async submit(id: string, input: SubmitMessage): Promise<Mission> {
    return transaction(this.pool, async (client) => {
      const row = (await client.query('SELECT * FROM conversations WHERE id=$1 FOR UPDATE', [id]))
        .rows[0];
      if (!row) throw new DomainError(404, 'not_found', 'Conversation introuvable.');
      const inputHash = hash(input);
      const existing = (
        await client.query(
          'SELECT * FROM messages WHERE conversation_id=$1 AND client_message_id=$2',
          [id, input.client_message_id],
        )
      ).rows[0];
      if (existing) {
        if (existing.request_hash !== inputHash)
          throw new DomainError(
            409,
            'idempotency_conflict',
            'Cet identifiant a déjà été utilisé pour un autre message.',
          );
        return mission(
          (await client.query('SELECT * FROM missions WHERE id=$1', [existing.mission_id]))
            .rows[0]!,
        );
      }
      if (row.version !== input.expected_conversation_version)
        throw new DomainError(
          409,
          'version_conflict',
          'La conversation a changé. Actualisez-la avant de renvoyer votre message.',
        );
      if (
        (
          await client.query(
            "SELECT id FROM missions WHERE conversation_id=$1 AND status IN ('queued','running','cancel_requested')",
            [id],
          )
        ).rowCount
      )
        throw new DomainError(
          409,
          'mission_active',
          'Une mission est déjà en cours dans cette conversation.',
        );
      const intent = this.mode === 'live' ? managementIntent(input.text) : null;
      const runtime =
        this.mode === 'live' && !intent
          ? await new HarnessRepository(this.pool).resolve(client)
          : null;
      const missionId = randomUUID();
      const created = (
        await client.query(
          "INSERT INTO missions(id,conversation_id,input,status,harness,runtime,orchestration_version) VALUES ($1,$2,$3,'queued',$4,$5,$6) RETURNING *",
          [
            missionId,
            id,
            input.text,
            intent ? 'control' : (runtime?.harness ?? 'mock'),
            runtime,
            runtime ? 1 : 0,
          ],
        )
      ).rows[0]!;
      await client.query(
        "INSERT INTO messages(id,conversation_id,mission_id,client_message_id,request_hash,role,content) VALUES ($1,$2,$3,$4,$5,'user',$6)",
        [randomUUID(), id, missionId, input.client_message_id, inputHash, input.text],
      );
      await client.query(
        'UPDATE conversations SET version=version+1, title=CASE WHEN version=0 THEN $2 ELSE title END WHERE id=$1',
        [id, input.text.slice(0, 80)],
      );
      await appendEvent(client, missionId, 'mission.queued', {
        message: 'Mission enregistrée.',
        simulated: !runtime,
      });
      if (intent) {
        const text = await manage(client, new HarnessRepository(this.pool), missionId, intent);
        await client.query("UPDATE missions SET status='succeeded',result=$2 WHERE id=$1", [
          missionId,
          text,
        ]);
        await client.query(
          "INSERT INTO messages(id,conversation_id,mission_id,role,content) VALUES($1,$2,$3,'assistant',$4)",
          [randomUUID(), id, missionId, text],
        );
        await client.query('UPDATE conversations SET version=version+1 WHERE id=$1', [id]);
        await appendEvent(client, missionId, 'mission.completed', {
          message: 'Demande de configuration traitée.',
          simulated: false,
        });
        created.status = 'succeeded';
        created.result = text;
      }
      if (runtime)
        await new HarnessRepository(this.pool).operation(
          missionId,
          'mission',
          { mission_id: missionId },
          client,
        );
      return mission(created);
    });
  }
  async getMission(id: string): Promise<Mission> {
    const row = (await this.pool.query('SELECT * FROM missions WHERE id=$1', [id])).rows[0];
    if (!row) throw new DomainError(404, 'not_found', 'Mission introuvable.');
    return mission(row);
  }
  async events(id: string, after = 0): Promise<MissionEvent[]> {
    return (
      await this.pool.query(
        'SELECT * FROM mission_events WHERE mission_id=$1 AND sequence>$2 ORDER BY sequence LIMIT 200',
        [id, after],
      )
    ).rows.map((row) => ({ ...row, occurred_at: date(row.occurred_at) })) as MissionEvent[];
  }
  async cancel(id: string): Promise<Mission> {
    return transaction(this.pool, async (client) => {
      const row = (await client.query('SELECT * FROM missions WHERE id=$1 FOR UPDATE', [id]))
        .rows[0];
      if (!row) throw new DomainError(404, 'not_found', 'Mission introuvable.');
      if (
        row.harness !== 'mock' &&
        ['queued', 'running', 'cancel_requested'].includes(row.status)
      ) {
        await client.query(
          "UPDATE missions SET status='cancel_requested',updated_at=now() WHERE id=$1",
          [id],
        );
        row.status = 'cancel_requested';
        await appendEvent(client, id, 'mission.cancel_requested', {
          message: 'Arrêt demandé au moteur.',
        });
      } else if (['queued', 'running'].includes(row.status)) {
        await client.query(
          "UPDATE missions SET status='cancelled',lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=$1",
          [id],
        );
        await appendEvent(client, id, 'mission.cancelled', {
          message: 'Mission arrêtée à votre demande.',
        });
        row.status = 'cancelled';
      }
      return mission(row);
    });
  }
  async claimNext(): Promise<Claim | null> {
    return transaction(this.pool, async (client) => {
      const row = (
        await client.query(
          `SELECT * FROM missions WHERE harness='mock' AND (status='queued' OR (status='running' AND lease_until<now())) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`,
        )
      ).rows[0];
      if (!row) return null;
      if (row.attempt >= 3) {
        await client.query(
          "UPDATE missions SET status='failed',lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=$1",
          [row.id],
        );
        await appendEvent(client, row.id, 'mission.failed', {
          message: 'Le nombre maximal de reprises a été atteint.',
        });
        return null;
      }
      const leaseToken = randomUUID();
      const updated = (
        await client.query(
          "UPDATE missions SET status='running',attempt=attempt+1,lease_token=$2,lease_until=now()+interval '15 seconds',updated_at=now() WHERE id=$1 RETURNING *",
          [row.id, leaseToken],
        )
      ).rows[0]!;
      await appendEvent(client, row.id, 'mission.started', {
        message: row.attempt
          ? 'Reprise de la simulation après interruption.'
          : 'Jarvis prend en charge votre demande.',
        attempt: updated.attempt,
      });
      return { mission: mission(updated), leaseToken };
    });
  }
  async renew(claim: Claim): Promise<boolean> {
    return Boolean(
      (
        await this.pool.query(
          "UPDATE missions SET lease_until=now()+interval '15 seconds' WHERE id=$1 AND lease_token=$2 AND status='running' AND lease_until>now()",
          [claim.mission.id, claim.leaseToken],
        )
      ).rowCount,
    );
  }
  async recordProgress(claim: Claim, text: string): Promise<boolean> {
    return transaction(this.pool, async (client) => {
      if (!(await this.lockClaim(client, claim))) return false;
      await appendEvent(client, claim.mission.id, 'mission.progress', { message: text });
      return true;
    });
  }
  private async lockClaim(client: PoolClient, claim: Claim): Promise<boolean> {
    return Boolean(
      (
        await client.query(
          "SELECT id FROM missions WHERE id=$1 AND lease_token=$2 AND status='running' AND lease_until>now() FOR UPDATE",
          [claim.mission.id, claim.leaseToken],
        )
      ).rowCount,
    );
  }
  async finish(claim: Claim, text: string): Promise<boolean> {
    return transaction(this.pool, async (client) => {
      // Match submit's lock order: conversation, then mission, to avoid deadlocks.
      await client.query('SELECT id FROM conversations WHERE id=$1 FOR UPDATE', [
        claim.mission.conversation_id,
      ]);
      if (!(await this.lockClaim(client, claim))) return false;
      await client.query(
        "UPDATE missions SET status='succeeded',result=$2,lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=$1",
        [claim.mission.id, text],
      );
      await client.query(
        "INSERT INTO messages(id,conversation_id,mission_id,role,content) VALUES ($1,$2,$3,'assistant',$4)",
        [randomUUID(), claim.mission.conversation_id, claim.mission.id, text],
      );
      await client.query('UPDATE conversations SET version=version+1 WHERE id=$1', [
        claim.mission.conversation_id,
      ]);
      await appendEvent(client, claim.mission.id, 'mission.completed', {
        message: 'Simulation terminée.',
        simulated: true,
      });
      return true;
    });
  }
  async fail(claim: Claim): Promise<void> {
    await transaction(this.pool, async (client) => {
      if (!(await this.lockClaim(client, claim))) return;
      await client.query(
        "UPDATE missions SET status='failed',lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=$1",
        [claim.mission.id],
      );
      await appendEvent(client, claim.mission.id, 'mission.failed', {
        message: 'La mission a rencontré une erreur. Vous pouvez envoyer une nouvelle demande.',
      });
    });
  }
  async release(claim: Claim): Promise<void> {
    await this.pool.query(
      "UPDATE missions SET lease_until=now()-interval '1 second' WHERE id=$1 AND lease_token=$2 AND status='running'",
      [claim.mission.id, claim.leaseToken],
    );
  }
  async createSession(tokenHash: string, csrfToken: string, expiresAt: Date): Promise<void> {
    await this.pool.query('DELETE FROM app_sessions WHERE expires_at<=now()');
    await this.pool.query('INSERT INTO app_sessions VALUES ($1,$2,$3)', [
      tokenHash,
      csrfToken,
      expiresAt,
    ]);
  }
  async session(tokenHash: string): Promise<{ csrf_token: string; expires_at: Date } | null> {
    return (
      (
        await this.pool.query(
          'SELECT csrf_token,expires_at FROM app_sessions WHERE token_hash=$1 AND expires_at>now()',
          [tokenHash],
        )
      ).rows[0] ?? null
    );
  }
  async deleteSession(tokenHash: string): Promise<void> {
    await this.pool.query('DELETE FROM app_sessions WHERE token_hash=$1', [tokenHash]);
  }
}
