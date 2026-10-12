import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createHash, randomUUID } from 'node:crypto';
import { DomainError, transaction, type Pool } from '@jarvis/storage';
import type { SupervisorClient } from './supervisor-client.ts';
const settingsSchema = z
  .object({
    repository: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/),
    branch: z.string().min(1).max(150),
    revision: z.number().int().nonnegative(),
  })
  .strict();
const idSchema = z.object({ id: z.uuid() });
export function registerGitHubRoutes(
  app: FastifyInstance,
  pool: Pool,
  supervisor: SupervisorClient,
) {
  app.get('/api/v1/github', async () => ({
    settings: (await pool.query('SELECT * FROM github_settings')).rows[0],
    connection: await supervisor.call({ action: 'github_status' }),
  }));
  app.post('/api/v1/github/connect', async () => supervisor.call({ action: 'github_connect' }));
  app.post('/api/v1/github/disconnect', async () =>
    supervisor.call({ action: 'github_disconnect' }),
  );
  app.post('/api/v1/github/repository', async (req) => {
    const input = settingsSchema.parse(req.body);
    await supervisor.call({
      action: 'github_repository',
      repository: input.repository,
      branch: input.branch,
    });
    const result = await pool.query(
      'UPDATE github_settings SET repository=$1,base_branch=$2,revision=revision+1 WHERE singleton=true AND revision=$3 RETURNING *',
      [input.repository, input.branch, input.revision],
    );
    if (!result.rowCount)
      throw new DomainError(
        409,
        'github_settings_conflict',
        'Les réglages GitHub ont changé. Rechargez-les.',
      );
    return result.rows[0];
  });
  app.get('/api/v1/development/:id/github', async (req) => {
    const { id } = idSchema.parse(req.params);
    return {
      publication:
        (
          await pool.query(
            'SELECT change_id,state,result,error,digest FROM github_publications WHERE change_id=$1',
            [id],
          )
        ).rows[0] ?? null,
    };
  });
  app.post('/api/v1/development/:id/github', async (req, reply) => {
    const { id } = idSchema.parse(req.params);
    const { digest } = z
      .object({ digest: z.string().regex(/^[a-f0-9]{64}$/) })
      .strict()
      .parse(req.body);
    const result = await transaction(pool, async (c) => {
      const change = (
        await c.query(
          'SELECT d.*,m.status AS mission_status FROM development_changes d JOIN missions m ON m.id=d.mission_id WHERE d.id=$1 FOR UPDATE OF d',
          [id],
        )
      ).rows[0];
      if (!change) throw new DomainError(404, 'change_missing', 'Proposition introuvable.');
      if (
        change.status !== 'proposed' ||
        change.mission_status !== 'succeeded' ||
        change.validation?.passed !== true ||
        change.review?.verdict !== 'approve'
      )
        throw new DomainError(
          409,
          'github_not_reviewed',
          'La mission doit être terminée, avec tests réussis et revue favorable.',
        );
      if (!change.source?.commit)
        throw new DomainError(
          409,
          'github_source_missing',
          'Cette proposition utilise une ancienne copie locale. Configurez GitHub puis lancez une nouvelle mission.',
        );
      if (
        digest !== change.artifact?.digest ||
        digest !== createHash('sha256').update(change.artifact.patch).digest('hex')
      )
        throw new DomainError(
          409,
          'github_artifact_changed',
          'Le patch a changé. Rechargez la proposition.',
        );
      const settings = (await c.query('SELECT * FROM github_settings')).rows[0];
      if (
        settings.repository !== change.source.repository ||
        settings.base_branch !== change.source.branch
      )
        throw new DomainError(
          409,
          'github_settings_conflict',
          'Le dépôt configuré ne correspond plus à la proposition.',
        );
      const existing = (await c.query('SELECT * FROM github_publications WHERE change_id=$1', [id]))
        .rows[0];
      if (existing && existing.digest !== digest)
        throw new DomainError(
          409,
          'github_artifact_changed',
          'Une autre version du patch est déjà associée à cette publication.',
        );
      if (existing && existing.state !== 'failed') return existing;
      const payload = existing?.payload ?? {
        action: 'github_publish',
        id,
        repository: change.source.repository,
        branch: change.source.branch,
        base_commit: change.source.commit,
        digest,
        patch: change.artifact.patch,
        title: change.task.replace(/[\r\n]/g, ' ').slice(0, 150),
        body: `## Modification proposée\n\n${change.task}\n\n## Validation\n\n- TypeScript et tests unitaires de référence : réussis.\n- Revue indépendante : favorable.\n- Base : ${change.source.commit}\n- SHA-256 du patch : ${digest}\n\n${String(change.review.summary).slice(0, 3000)}\n\nPR en brouillon. Tests d'intégration, validation de release et déploiement restent à effectuer.\n\nJarvis change: ${id}`,
      };
      const op = randomUUID();
      await c.query(
        "INSERT INTO harness_operations(id,kind,request_hash,payload) VALUES($1,'github_publish',$2,$3)",
        [op, digest, { change_id: id }],
      );
      return (
        await c.query(
          "INSERT INTO github_publications(change_id,operation_id,digest,payload) VALUES($1,$2,$3,$4) ON CONFLICT(change_id) DO UPDATE SET operation_id=$2,state='queued',error=NULL,updated_at=now() RETURNING *",
          [id, op, digest, payload],
        )
      ).rows[0];
    });
    return reply
      .code(202)
      .send({
        publication: {
          state: result.state,
          result: result.result,
          error: result.error,
          digest: result.digest,
        },
      });
  });
}
