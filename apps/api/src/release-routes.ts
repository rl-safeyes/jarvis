import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { DomainError, transaction, type Pool } from '@jarvis/storage';
import type { SupervisorClient } from './supervisor-client.ts';
const fingerprint = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function registerReleaseRoutes(
  app: FastifyInstance,
  pool: Pool,
  supervisor: SupervisorClient,
) {
  const load = async (c: any, id: string) => {
    const r = (
      await c.query(
        `SELECT d.status,d.artifact,d.source,d.validation,d.review,m.status AS mission_status,p.state AS publication_state,p.digest,p.result,s.repository,s.base_branch FROM development_changes d JOIN missions m ON m.id=d.mission_id JOIN github_publications p ON p.change_id=d.id CROSS JOIN github_settings s WHERE d.id=$1`,
        [id],
      )
    ).rows[0];
    if (!r)
      throw new DomainError(
        404,
        'release_missing',
        'Publiez d’abord une PR pour cette proposition.',
      );
    return r;
  };
  const eligibility = (r: any) =>
    r.status === 'proposed' &&
    r.mission_status === 'succeeded' &&
    r.validation?.passed === true &&
    r.review?.verdict === 'approve' &&
    r.publication_state === 'succeeded' &&
    r.result?.commit &&
    r.source?.repository === r.repository &&
    r.source?.branch === r.base_branch &&
    r.digest === r.artifact?.digest &&
    r.digest ===
      createHash('sha256')
        .update(r.artifact?.patch ?? '')
        .digest('hex');
  app.get('/api/v1/development/:id/release', async (req) => {
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const r = await load(pool, id);
    const row = (
      await pool.query(
        'SELECT report,binding FROM release_checks WHERE change_id=$1 ORDER BY started_at DESC LIMIT 1',
        [id],
      )
    ).rows[0];
    return {
      report: row?.report ?? null,
      stale: Boolean(row && (!eligibility(r) || row.binding !== fingerprint(r))),
    };
  });
  app.post('/api/v1/development/:id/release', async (req) => {
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const input = z
      .object({
        digest: z.string().regex(/^[a-f0-9]{64}$/),
        commit: z.string().regex(/^[a-f0-9]{40}$/),
      })
      .strict()
      .parse(req.body);
    const r = await load(pool, id);
    if (!eligibility(r) || input.digest !== r.digest || input.commit !== r.result.commit)
      throw new DomainError(
        409,
        'release_stale',
        'La proposition ou sa publication a changé. Rechargez-la.',
      );
    const binding = fingerprint(r);
    const started = new Date();
    const report = await supervisor.call({
      action: 'github_qualify',
      id,
      repository: r.source.repository,
      branch: r.source.branch,
      base_commit: r.source.commit,
      commit: r.result.commit,
      digest: r.digest,
      number: r.result.number,
    });
    if (
      report.commit !== r.result.commit ||
      report.patch_digest !== r.digest ||
      !['passed', 'blocked', 'waiting'].includes(report.state) ||
      report.deploy_allowed !== false
    )
      throw new DomainError(502, 'release_invalid', 'Rapport de qualification invalide.');
    await transaction(pool, async (c) => {
      // Serialize with publication/configuration updates and validate the immutable binding again.
      await c.query('SELECT id FROM development_changes WHERE id=$1 FOR UPDATE', [id]);
      await c.query('SELECT change_id FROM github_publications WHERE change_id=$1 FOR UPDATE', [
        id,
      ]);
      await c.query('SELECT singleton FROM github_settings FOR SHARE');
      if (fingerprint(await load(c, id)) !== binding)
        throw new DomainError(
          409,
          'release_stale',
          'La proposition a changé pendant la vérification. Relancez-la.',
        );
      await c.query(
        'INSERT INTO release_checks(change_id,started_at,binding,report) VALUES($1,$2,$3,$4)',
        [id, started, binding, report],
      );
    });
    return { report, stale: false };
  });
}
