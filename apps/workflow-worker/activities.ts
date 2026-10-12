import { publishGitHubChange } from './github-publication.ts';
import { githubErrors } from '../api/src/github-errors.ts';
import { Orchestrator } from './orchestration.ts';
import { heartbeat } from '@temporalio/activity';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { Pool, transaction } from '@jarvis/storage';
import { SupervisorClient } from '../api/src/supervisor-client.ts';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const supervisor = new SupervisorClient(
  process.env.JARVIS_SUPERVISOR_URL ?? 'http://supervisor:7080',
  process.env.JARVIS_SUPERVISOR_TOKEN ?? '',
);
export async function closeActivities() {
  await pool.end();
}
async function event(c: any, id: string, type: string, message: string) {
  await c.query(
    `INSERT INTO mission_events(event_id,mission_id,sequence,type,payload)
    SELECT $1,$2,COALESCE(MAX(sequence),0)+1,$3,$4 FROM mission_events WHERE mission_id=$2`,
    [randomUUID(), id, type, { message, simulated: false }],
  );
}
async function completeMission(
  id: string,
  state: string,
  text: string | null,
  error: string | null,
  cancellationConfirmed = true,
) {
  await transaction(pool, async (c) => {
    const initial = (await c.query('SELECT conversation_id FROM missions WHERE id=$1', [id]))
      .rows[0];
    await c.query('SELECT id FROM conversations WHERE id=$1 FOR UPDATE', [initial.conversation_id]);
    const m = (await c.query('SELECT * FROM missions WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (['succeeded', 'failed', 'cancelled'].includes(m.status)) return;
    const terminal = m.status === 'cancel_requested' && cancellationConfirmed ? 'cancelled' : state;
    await c.query('UPDATE missions SET status=$2,result=$3,updated_at=now() WHERE id=$1', [
      id,
      terminal,
      terminal === 'succeeded' ? text : null,
    ]);
    if (terminal === 'succeeded') {
      await c.query(
        "INSERT INTO messages(id,conversation_id,mission_id,role,content) VALUES($1,$2,$3,'assistant',$4) ON CONFLICT(mission_id,role) DO NOTHING",
        [randomUUID(), m.conversation_id, id, text],
      );
      await c.query('UPDATE conversations SET version=version+1 WHERE id=$1', [m.conversation_id]);
    }
    await event(
      c,
      id,
      terminal === 'succeeded' ? 'mission.completed' : `mission.${terminal}`,
      terminal === 'succeeded'
        ? 'Réponse du moteur enregistrée.'
        : terminal === 'cancelled'
          ? 'Le moteur a été arrêté.'
          : (error ?? 'Exécution interrompue.'),
    );
  });
}
export async function executeOperation(id: string): Promise<void> {
  const op = (await pool.query('SELECT * FROM harness_operations WHERE id=$1', [id])).rows[0];
  if (!op || ['succeeded', 'failed', 'cancelled'].includes(op.state)) return;
  await pool.query("UPDATE harness_operations SET state='running',updated_at=now() WHERE id=$1", [
    id,
  ]);
  const pulse = setInterval(() => heartbeat(), 5000);
  heartbeat();
  try {
    if (op.kind === 'github_publish') {
      await publishGitHubChange(pool, supervisor, id, op.payload.change_id, heartbeat);
      return;
    }
    if (op.kind === 'install') {
      await pool.query(
        "UPDATE harness_installations SET state='installing',error=NULL WHERE id=$1",
        [op.payload.harness],
      );
      const result = await supervisor.call({ action: 'install', harness: op.payload.harness });
      await transaction(pool, async (c) => {
        await c.query(
          "UPDATE harness_installations SET state='installed',image_digest=$2,error=NULL,updated_at=now() WHERE id=$1",
          [op.payload.harness, result.image_digest],
        );
        await c.query(
          "UPDATE harness_operations SET state='succeeded',result=$2,updated_at=now() WHERE id=$1",
          [id, result],
        );
      });
      return;
    }
    let runtime = op.payload;
    let prompt = 'Réponds uniquement par OK pour vérifier cette connexion.';
    let instructions = 'Tu vérifies une connexion. Aucun outil.';
    if (op.kind === 'mission') {
      const m = (await pool.query('SELECT * FROM missions WHERE id=$1', [id])).rows[0];
      if (['succeeded', 'failed', 'cancelled'].includes(m.status)) {
        await pool.query('UPDATE harness_operations SET state=$2,updated_at=now() WHERE id=$1', [
          id,
          m.status,
        ]);
        return;
      }
      if (m.orchestration_version === 1) {
        const result = await new Orchestrator(pool, supervisor, heartbeat).execute(id);
        await completeMission(id, result.state, result.text, result.error ?? null);
        const current = (await pool.query('SELECT status FROM missions WHERE id=$1', [id])).rows[0];
        await pool.query(
          'UPDATE harness_operations SET state=$2,result=$3,error=$4,updated_at=now() WHERE id=$1',
          [id, current.status, { message: 'Mission orchestrée terminée.' }, result.error ?? null],
        );
        return;
      }
      runtime = m.runtime;
      instructions = runtime.instructions;
      if (m.status === 'queued')
        await transaction(pool, async (c) => {
          const changed = await c.query(
            "UPDATE missions SET status='running',attempt=attempt+1,updated_at=now() WHERE id=$1 AND status='queued' RETURNING id",
            [id],
          );
          if (changed.rowCount)
            await event(
              c,
              id,
              'mission.started',
              `Exécution avec ${runtime.harness} · ${runtime.model}.`,
            );
        });
      const messages = (
        await pool.query(
          "SELECT role,content FROM messages WHERE conversation_id=$1 AND position <= (SELECT position FROM messages WHERE mission_id=$2 AND role='user') ORDER BY position DESC LIMIT 20",
          [m.conversation_id, id],
        )
      ).rows.reverse();
      prompt = messages
        .map((x) => `${x.role}: ${x.content}`)
        .join('\n\n')
        .slice(-64000);
    }
    const base = {
      harness: runtime.harness,
      account_id: runtime.account_id,
      image_digest: runtime.image_digest,
    };
    const account = (
      await pool.query('SELECT * FROM harness_accounts WHERE id=$1', [runtime.account_id])
    ).rows[0];
    if (!account || account.state !== 'ready' || account.revision !== runtime.account_revision) {
      // Cancel first, including the case where a prior attempt reached the runtime.
      await supervisor.call({ ...base, action: 'cancel', id });
      throw new Error('Compte modifié ou déconnecté. Reconnectez et testez le profil.');
    }
    const deadline = Date.now() + 5 * 60000;
    let result: any;
    while (true) {
      heartbeat();
      const current =
        op.kind === 'mission'
          ? (await pool.query('SELECT status FROM missions WHERE id=$1', [id])).rows[0]?.status
          : null;
      const latestAccount = (
        await pool.query('SELECT state,revision FROM harness_accounts WHERE id=$1', [
          runtime.account_id,
        ])
      ).rows[0];
      if (
        current === 'cancel_requested' ||
        !latestAccount ||
        latestAccount.state !== 'ready' ||
        latestAccount.revision !== runtime.account_revision ||
        Date.now() > deadline
      ) {
        result = await supervisor.call({ ...base, action: 'cancel', id });
      } else {
        result = await supervisor.call({
          ...base,
          action: 'start',
          id,
          model: runtime.model,
          prompt,
          instructions,
        });
      }
      if (['succeeded', 'failed', 'cancelled'].includes(result.state)) break;
      await sleep(1000);
    }
    if (op.kind === 'mission')
      await completeMission(id, result.state, result.text ?? null, result.error ?? null);
    if (op.kind === 'test' && result.state === 'succeeded')
      await pool.query(
        "UPDATE execution_profiles SET state='ready',tested_revision=$2 WHERE id=$1",
        [runtime.profile_id, runtime.account_revision],
      );
    await pool.query(
      'UPDATE harness_operations SET state=$2,result=$3,error=$4,updated_at=now() WHERE id=$1',
      [
        id,
        result.state,
        { message: op.kind === 'test' ? 'Test de connexion terminé.' : 'Mission terminée.' },
        result.error ?? null,
      ],
    );
  } catch (error) {
    // Transport failures are retried by Temporal. Runtime start is idempotent on operation id.
    const { Context } = await import('@temporalio/activity');
    if (Context.current().info.attempt < 3) throw error;
    const message =
      'Opération interrompue. Vérifiez le runtime, la connexion et le modèle puis relancez explicitement.';
    if (op.kind === 'github_publish')
      await pool.query(
        "UPDATE github_publications SET state='failed',error=$2,updated_at=now() WHERE operation_id=$1",
        [id, githubErrors.github_unavailable],
      );
    if (op.kind === 'mission') {
      let confirmed = true;
      try {
        await new Orchestrator(pool, supervisor, heartbeat).stopChildren(id);
      } catch {
        confirmed = false;
        await pool.query(
          "UPDATE mission_steps SET status='failed',error=$2,updated_at=now() WHERE mission_id=$1 AND status IN ('queued','running')",
          [id, 'État du runtime inconnu : arrêt non confirmé.'],
        );
      }
      await completeMission(
        id,
        'failed',
        null,
        confirmed
          ? message
          : 'État du runtime inconnu : l’arrêt des tâches n’a pas pu être confirmé. Vérifiez le runtime avant de relancer.',
        confirmed,
      );
    }
    if (op.kind === 'install')
      await pool.query("UPDATE harness_installations SET state='failed',error=$2 WHERE id=$1", [
        op.payload.harness,
        message,
      ]);
    await pool.query(
      "UPDATE harness_operations SET state='failed',error=$2,updated_at=now() WHERE id=$1",
      [id, message],
    );
  } finally {
    clearInterval(pulse);
  }
}
