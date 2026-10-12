import { trustedPolicy } from '../github-bridge/qualification.mjs';
import { Pool, migrate } from '@jarvis/storage';
import {
  enqueueRelease,
  releaseInput,
  reportEvidence,
  releaseHash,
} from '../../packages/storage/src/releases.ts';
import { advance } from './engine.mjs';
import { Docker, AppDeployer, command } from './docker.mjs';
import { statfs } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
await migrate(pool);
const lock = await pool.connect();
if (!(await lock.query('SELECT pg_try_advisory_lock(147026,1) AS locked')).rows[0].locked)
  throw new Error('A release controller is already active');
let alive = true;
lock.on('error', () => {
  alive = false;
  process.exit(1);
});
const guard = async () => {
  if (!alive) throw new Error('release_lock_lost');
  await lock.query('SELECT 1');
};
const docker = new Docker(),
  deployer = new AppDeployer(docker, process.env.JARVIS_COMPOSE_PROJECT ?? 'jarvis', guard);
const root = fileURLToPath(new URL('../../', import.meta.url));
async function github(input: any) {
  await guard();
  const r = await fetch('http://github:7081/request', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.JARVIS_SUPERVISOR_TOKEN}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(60000),
  });
  const data = await r.json();
  if (!r.ok)
    throw Object.assign(new Error(data.error_code ?? 'release_transport'), {
      code: data.error_code,
    });
  return data;
}
async function operation(input: any) {
  for (let i = 0; i < 900; i++) {
    const r = await github(input);
    if (r.state === 'succeeded') return r.result;
    if (r.state === 'failed') throw Object.assign(new Error(r.error_code), { code: r.error_code });
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('release_timeout');
}
const messages: Record<string, string> = {
  github_release_stale:
    'Les preuves, le commit ou la politique ont changé. Préparez une nouvelle version.',
  github_release_scope: 'Ce changement sort du périmètre documentation/interface sans migration.',
  github_release_protected:
    'La branche est protégée par des règles GitHub. Une fusion opérateur dédiée est nécessaire.',
  github_release_conflict: 'La branche GitHub a changé. Aucune référence n’a été forcée.',
  release_target_changed: 'La version déployée a changé en dehors de ce contrôleur.',
  release_enrollment_required:
    'Installez une image Jarvis identifiée par son commit avant une release.',
  release_health_failed: 'Les contrôles de la nouvelle application ont échoué.',
  release_disk_full:
    'Espace disque insuffisant pour conserver deux images et construire la suivante.',
  release_auto_denied: 'L’autorisation automatique est désactivée ou sa politique a changé.',
};
async function save(id: string, state: string, fields: any = {}) {
  const allowed = ['artifact', 'approved_at', 'monitor_until', 'error', 'merge_attempts'];
  const entries = Object.entries(fields).filter(([k]) => allowed.includes(k));
  const values = [id, state, ...entries.map(([, v]) => v)];
  return (
    await pool.query(
      `UPDATE deployments SET state=$2,revision=revision+1,updated_at=now()${entries.map(([k], i) => `,${k}=$${i + 3}`).join('')} WHERE id=$1 RETURNING *`,
      values,
    )
  ).rows[0];
}
async function autoAllowed(job: any) {
  const s = (await pool.query('SELECT * FROM release_settings')).rows[0];
  return s.auto_enabled && s.policy_digest === job.payload.policy_digest;
}
async function check(job: any) {
  if ((await trustedPolicy()).digest !== job.payload.policy_digest)
    throw new Error('github_release_stale');
  const current = await releaseInput(pool, job.change_id);
  for (const key of Object.keys(current))
    if (current[key as keyof typeof current] !== job.payload[key])
      throw new Error('github_release_stale');
  if (job.automatic && !(await autoAllowed(job))) throw new Error('release_auto_denied');
  const report = await github({ action: 'github_qualify', ...job.payload });
  if (
    report.state !== 'passed' ||
    report.policy_digest !== job.payload.policy_digest ||
    reportEvidence(report) !== job.payload.evidence ||
    report.risk?.level === 'high' ||
    (job.automatic && report.risk?.level !== 'low')
  )
    throw new Error('github_release_stale');
  return report;
}
const io = {
  save,
  now: Date.now,
  check,
  autoAllowed,
  safeError: (e: any) =>
    messages[e.code ?? e.message] ??
    'La release a été interrompue. Son état a été conservé pour une reprise.',
  note: async (id: string, error: string) => {
    await pool.query(
      'UPDATE deployments SET error=$2,merge_attempts=merge_attempts+1,updated_at=now() WHERE id=$1',
      [id, error],
    );
  },
  assertTarget: (j: any) => deployer.assertTarget(j),
  maintenance: async (enabled: boolean) => {
    await guard();
    await pool.query('UPDATE release_settings SET maintenance=$1', [enabled]);
  },
  prepare: async (job: any) => {
    const space = await statfs('/state');
    if (Number(space.bavail) * Number(space.bsize) < 2 * 1024 ** 3)
      throw new Error('release_disk_full');
    let artifact = job.artifact;
    if (!artifact?.previous_container) {
      artifact = await deployer.capture();
      await save(job.id, 'preparing', { artifact });
    }
    const source = await operation({
      action: 'github_release_export',
      ...job.payload,
      deployed_commit: artifact.deployed_commit,
    });
    if (source.commit !== job.payload.commit || source.release_id !== job.id)
      throw new Error('github_release_stale');
    if (!artifact.image) {
      const tag = `jarvis-release:${job.id}`;
      let image = await docker.call('GET', `/images/${tag}/json`);
      if (
        image &&
        (image.Config.Labels?.['jarvis.release'] !== job.id ||
          image.Config.Labels?.['org.opencontainers.image.revision'] !== job.payload.commit)
      )
        throw new Error('release_target_changed');
      if (!image) {
        await guard();
        await command('docker', [
          'build',
          '--label',
          `jarvis.release=${job.id}`,
          '--build-arg',
          `JARVIS_SOURCE_COMMIT=${job.payload.commit}`,
          '-f',
          path.join(root, 'infra/Dockerfile'),
          '-t',
          tag,
          `/sources/releases/${job.id}/repo`,
        ]);
        image = await docker.call('GET', `/images/${tag}/json`);
      }
      artifact = { ...artifact, image: image.Id };
      await save(job.id, 'preparing', { artifact });
    }
    for (const image of [artifact.previous_image, artifact.image]) {
      await guard();
      await command(process.execPath, [path.join(root, 'scripts/preproduction.mjs'), image], {
        cwd: root,
        env: {
          PATH: process.env.PATH,
          GITHUB_SHA: job.payload.commit,
          JARVIS_PREPROD_ID: job.id,
          JARVIS_PROBE_REPORT_DIR: '/tmp',
        },
      });
    }
    await deployer.assertTarget({ ...job, artifact });
    await check(job);
    return artifact;
  },
  merge: async (job: any) => {
    if (job.merge_attempts >= 10)
      throw Object.assign(new Error('release_merge_unknown'), { terminal: true });
    await operation({ action: 'github_release_merge', ...job.payload, automatic: job.automatic });
  },
  promote: (job: any) => deployer.promote(job),
  healthy: (job: any) => deployer.healthy(job),
  rollback: (job: any) => deployer.rollback(job),
};
let lastDiscovery = 0;
async function discover() {
  if (Date.now() - lastDiscovery < 60000) return;
  lastDiscovery = Date.now();
  const s = (await pool.query('SELECT * FROM release_settings')).rows[0];
  if (!s.auto_enabled) return;
  if (
    (
      await pool.query(
        "SELECT id FROM deployments WHERE state IN ('merge_unknown','rollback_failed')",
      )
    ).rowCount
  )
    return;
  const candidates = (
    await pool.query(
      `SELECT p.change_id FROM github_publications p WHERE p.state='succeeded' AND NOT EXISTS(SELECT 1 FROM deployments d WHERE d.change_id=p.change_id) ORDER BY p.created_at LIMIT 10`,
    )
  ).rows;
  for (const candidate of candidates)
    try {
      const input = await releaseInput(pool, candidate.change_id);
      const report = await github({ action: 'github_qualify', ...input });
      if (
        report.state !== 'passed' ||
        report.risk?.level !== 'low' ||
        report.policy_digest !== s.policy_digest
      )
        continue;
      const observed = (
        await pool.query(
          `SELECT d.status,d.artifact,d.source,d.validation,d.review,m.status AS mission_status,p.state AS publication_state,p.digest,p.result,s.repository,s.base_branch FROM development_changes d JOIN missions m ON m.id=d.mission_id JOIN github_publications p ON p.change_id=d.id CROSS JOIN github_settings s WHERE d.id=$1`,
          [candidate.change_id],
        )
      ).rows[0];
      await pool.query(
        'INSERT INTO release_checks(change_id,started_at,binding,report) VALUES($1,now(),$2,$3)',
        [candidate.change_id, releaseHash(observed), report],
      );
      await enqueueRelease(
        pool,
        candidate.change_id,
        { commit: input.commit, digest: input.digest, policy_digest: report.policy_digest },
        true,
      );
      return;
    } catch {
      /* No release side effect on unavailable evidence. */
    }
}
process.once('SIGTERM', () => {
  alive = false;
});
process.once('SIGINT', () => {
  alive = false;
});
while (alive) {
  try {
    await guard();
    await pool.query('UPDATE release_settings SET controller_seen_at=now()');
    const job = (
      await pool.query(
        "SELECT * FROM deployments WHERE state IN ('preparing','awaiting_approval','queued','merging','deploying','monitoring','rollback_pending') ORDER BY created_at LIMIT 1",
      )
    ).rows[0];
    if (job) await advance(job, io);
    else await discover();
  } catch {
    console.error('Release controller: operation deferred; state retained.');
  }
  await new Promise((r) => setTimeout(r, 5000));
}
await lock.query('SELECT pg_advisory_unlock(147026,1)');
lock.release();
await pool.end();
