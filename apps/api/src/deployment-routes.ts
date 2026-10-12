import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DomainError, transaction, type Pool } from '@jarvis/storage';
import {
  enqueueRelease,
  publicDeployment,
  releaseInput,
} from '../../../packages/storage/src/releases.ts';
import type { SupervisorClient } from './supervisor-client.ts';
export function registerDeploymentRoutes(
  app: FastifyInstance,
  pool: Pool,
  supervisor: SupervisorClient,
) {
  const settings = async () => {
    const s = (
      await pool.query(
        "SELECT *,controller_seen_at>now()-interval '2 minutes' AS controller_online FROM release_settings",
      )
    ).rows[0];
    return s;
  };
  app.get('/api/v1/release-settings', async () => ({
    settings: await settings(),
    deployments: (
      await pool.query('SELECT * FROM deployments ORDER BY created_at DESC LIMIT 10')
    ).rows.map(publicDeployment),
  }));
  app.post('/api/v1/release-settings', async (req) => {
    const input = z
      .object({
        auto_enabled: z.boolean(),
        revision: z.number().int().nonnegative(),
        policy_digest: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict()
      .parse(req.body);
    const policy = await supervisor.call({ action: 'github_release_policy' });
    if (policy.digest !== input.policy_digest)
      throw new DomainError(
        409,
        'release_policy_changed',
        'La politique installée a changé. Actualisez les réglages.',
      );
    const r = await pool.query(
      'UPDATE release_settings SET auto_enabled=$1,policy_digest=$2,revision=revision+1 WHERE revision=$3 RETURNING *',
      [input.auto_enabled, input.policy_digest, input.revision],
    );
    if (!r.rowCount)
      throw new DomainError(
        409,
        'release_settings_conflict',
        'Les réglages ont changé. Rechargez-les.',
      );
    return { settings: await settings() };
  });
  app.get('/api/v1/release-policy', async () =>
    supervisor.call({ action: 'github_release_policy' }),
  );
  app.get('/api/v1/development/:id/deployment', async (req) => {
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    return {
      deployment: publicDeployment(
        (
          await pool.query(
            'SELECT * FROM deployments WHERE change_id=$1 ORDER BY created_at DESC LIMIT 1',
            [id],
          )
        ).rows[0],
      ),
    };
  });
  app.post('/api/v1/development/:id/deployment', async (req, reply) => {
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const input = z
      .object({
        commit: z.string().regex(/^[a-f0-9]{40}$/),
        digest: z.string().regex(/^[a-f0-9]{64}$/),
        policy_digest: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict()
      .parse(req.body);
    if (!(await settings()).controller_online)
      throw new DomainError(
        503,
        'release_controller_offline',
        'Le contrôleur de release est indisponible.',
      );
    return reply
      .code(202)
      .send({ deployment: publicDeployment(await enqueueRelease(pool, id, input)) });
  });
  app.post('/api/v1/deployments/:id/action', async (req, reply) => {
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const input = z
      .object({
        action: z.enum(['approve', 'cancel', 'rollback', 'reconcile']),
        revision: z.number().int().nonnegative(),
        image: z.string().regex(/^sha256:[a-f0-9]{64}$/),
        commit: z.string().regex(/^[a-f0-9]{40}$/),
        policy_digest: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict()
      .parse(req.body);
    const row = await transaction(pool, async (c) => {
      await c.query('SELECT singleton FROM release_settings FOR UPDATE');
      const d = (await c.query('SELECT * FROM deployments WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (
        !d ||
        d.revision !== input.revision ||
        d.artifact?.image !== input.image ||
        d.payload.commit !== input.commit ||
        d.payload.policy_digest !== input.policy_digest
      )
        throw new DomainError(409, 'release_stale', 'La release affichée a changé. Rechargez-la.');
      let state;
      if (input.action === 'approve' && d.state === 'awaiting_approval') {
        const current = await releaseInput(c, d.change_id);
        for (const k of Object.keys(current))
          if (current[k as keyof typeof current] !== d.payload[k])
            throw new DomainError(409, 'release_stale', 'La proposition publiée a changé.');
        state = 'queued';
      } else if (input.action === 'cancel' && d.state === 'awaiting_approval') state = 'cancelled';
      else if (
        input.action === 'rollback' &&
        ['monitoring', 'succeeded', 'rollback_failed'].includes(d.state)
      )
        state = 'rollback_pending';
      else if (input.action === 'reconcile' && d.state === 'merge_unknown') state = 'merging';
      else
        throw new DomainError(
          409,
          'release_state',
          'Cette action ne correspond plus à l’état de la release.',
        );
      if (
        (
          await c.query(
            "SELECT id FROM deployments WHERE id<>$1 AND state IN ('preparing','awaiting_approval','queued','merging','merge_unknown','deploying','monitoring','rollback_pending','rollback_failed')",
            [id],
          )
        ).rowCount
      )
        throw new DomainError(409, 'release_busy', 'Une autre release est en cours.');
      return (
        await c.query(
          'UPDATE deployments SET state=$2,approved_at=CASE WHEN $3 THEN now() ELSE approved_at END,automatic=CASE WHEN $3 THEN false ELSE automatic END,merge_attempts=CASE WHEN $4 THEN 0 ELSE merge_attempts END,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *',
          [id, state, input.action === 'approve', input.action === 'reconcile'],
        )
      ).rows[0];
    });
    return reply.code(202).send({ deployment: publicDeployment(row) });
  });
}
