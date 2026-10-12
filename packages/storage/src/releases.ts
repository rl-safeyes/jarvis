import { randomUUID, createHash } from 'node:crypto';
import { transaction, DomainError, type Pool } from './index.ts';
export const releaseHash = (x: unknown) =>
  createHash('sha256').update(JSON.stringify(x)).digest('hex');
export const reportEvidence = (r: any) =>
  releaseHash({
    commit: r.commit,
    patch: r.patch_digest,
    policy: r.policy_digest,
    run: r.run,
    risk: r.risk,
  });
export const activeReleases = [
  'preparing',
  'awaiting_approval',
  'queued',
  'merging',
  'merge_unknown',
  'deploying',
  'monitoring',
  'rollback_pending',
  'rollback_failed',
];
export async function releaseInput(c: any, changeId: string) {
  const r = (
    await c.query(
      `SELECT d.*,m.status AS mission_status,p.state AS publication_state,p.digest AS published_digest,p.result,s.repository,s.base_branch FROM development_changes d JOIN missions m ON m.id=d.mission_id JOIN github_publications p ON p.change_id=d.id CROSS JOIN github_settings s WHERE d.id=$1`,
      [changeId],
    )
  ).rows[0];
  if (
    !r ||
    r.status !== 'proposed' ||
    r.mission_status !== 'succeeded' ||
    r.validation?.passed !== true ||
    r.review?.verdict !== 'approve' ||
    r.publication_state !== 'succeeded' ||
    !r.result?.commit ||
    r.source?.repository !== r.repository ||
    r.source?.branch !== r.base_branch ||
    r.published_digest !== r.artifact?.digest ||
    r.artifact.digest !== createHash('sha256').update(r.artifact.patch).digest('hex')
  )
    throw new DomainError(409, 'release_stale', 'La proposition publiée n’est plus éligible.');
  return {
    id: changeId,
    repository: r.source.repository,
    branch: r.source.branch,
    base_commit: r.source.commit,
    commit: r.result.commit,
    number: r.result.number,
    digest: r.artifact.digest,
  };
}
export async function enqueueRelease(
  pool: Pool,
  changeId: string,
  input: { commit: string; digest: string; policy_digest: string },
  automatic = false,
) {
  return transaction(pool, async (c) => {
    await c.query('SELECT singleton FROM release_settings FOR UPDATE');
    const existing = (
      await c.query(
        'SELECT * FROM deployments WHERE change_id=$1 ORDER BY created_at DESC LIMIT 1',
        [changeId],
      )
    ).rows[0];
    if (existing && activeReleases.includes(existing.state)) {
      if (
        existing.payload.commit !== input.commit ||
        existing.payload.digest !== input.digest ||
        existing.payload.policy_digest !== input.policy_digest
      )
        throw new DomainError(409, 'release_stale', 'La version préparée a changé.');
      return existing;
    }
    if (
      (await c.query('SELECT id FROM deployments WHERE state=ANY($1::text[])', [activeReleases]))
        .rowCount
    )
      throw new DomainError(409, 'release_busy', 'Une autre release est en cours.');
    const payload = await releaseInput(c, changeId);
    if (payload.commit !== input.commit || payload.digest !== input.digest)
      throw new DomainError(409, 'release_stale', 'Le commit ou le patch a changé.');
    const report = (
      await c.query(
        'SELECT report FROM release_checks WHERE change_id=$1 ORDER BY started_at DESC LIMIT 1',
        [changeId],
      )
    ).rows[0]?.report;
    if (
      report?.state !== 'passed' ||
      report.commit !== input.commit ||
      report.patch_digest !== input.digest ||
      report.policy_digest !== input.policy_digest ||
      report.risk?.level === 'high'
    )
      throw new DomainError(
        409,
        'release_checks_required',
        'Actualisez la préproduction. Les changements sensibles nécessitent une procédure dédiée.',
      );
    const settings = (await c.query('SELECT * FROM release_settings')).rows[0];
    if (
      automatic &&
      (!settings.auto_enabled ||
        settings.policy_digest !== input.policy_digest ||
        report.risk?.level !== 'low')
    )
      throw new DomainError(
        409,
        'release_auto_denied',
        'L’autonomie n’autorise pas cette version.',
      );
    const id = randomUUID();
    return (
      await c.query(
        'INSERT INTO deployments(id,change_id,payload,automatic) VALUES($1,$2,$3,$4) RETURNING *',
        [
          id,
          changeId,
          {
            ...payload,
            release_id: id,
            policy_digest: input.policy_digest,
            evidence: reportEvidence(report),
          },
          automatic,
        ],
      )
    ).rows[0];
  });
}
export function publicDeployment(r: any) {
  if (!r) return null;
  return {
    id: r.id,
    state: r.state,
    revision: r.revision,
    commit: r.payload.commit,
    policy_digest: r.payload.policy_digest,
    automatic: r.automatic,
    image: r.artifact?.image ?? null,
    previous_image: r.artifact?.previous_image ?? null,
    error: r.error,
    monitor_until: r.monitor_until,
    updated_at: r.updated_at,
  };
}
