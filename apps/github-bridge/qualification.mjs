import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
export const policyVersion = 'release-readiness-v1';
export const trustedPaths = [
  '.github/workflows/ci.yml',
  'scripts/preproduction.mjs',
  'scripts/preproduction-probe.mjs',
  'infra/Dockerfile',
];
const hash = (value) => createHash('sha256').update(value).digest('hex');
export async function trustedPolicy(root = new URL('../../', import.meta.url)) {
  const files = Object.fromEntries(
    await Promise.all(trustedPaths.map(async (p) => [p, hash(await readFile(new URL(p, root)))])),
  );
  return {
    files,
    digest: hash(
      JSON.stringify({
        version: policyVersion,
        files,
        code: hash(await readFile(new URL('./qualification.mjs', import.meta.url))),
      }),
    ),
  };
}
export function classifyRisk(files) {
  const reasons = [];
  let level = 'low';
  const raise = (next, reason) => {
    if (next === 'high' || level === 'low') level = next;
    if (!reasons.includes(reason)) reasons.push(reason);
  };
  if (!Array.isArray(files) || !files.length)
    return { level: 'high', reasons: ['Liste de fichiers absente.'], files: 0, lines: 0 };
  let lines = 0;
  for (const f of files) {
    const p = f.filename ?? '';
    if (
      !Number.isSafeInteger(f.additions) ||
      !Number.isSafeInteger(f.deletions) ||
      f.additions < 0 ||
      f.deletions < 0
    ) {
      raise('high', 'Statistiques du diff incomplètes.');
      continue;
    }
    lines += f.additions + f.deletions;
    if (typeof f.patch === 'string') {
      const diffLines = f.patch.split('\n');
      if (
        diffLines.filter((line) => line.startsWith('+')).length !== f.additions ||
        diffLines.filter((line) => line.startsWith('-')).length !== f.deletions
      )
        raise('high', 'Diff tronqué : les lignes ne correspondent pas aux statistiques.');
    }

    if (!p || /[\x00-\x1f\\]/.test(p) || p.split('/').some((s) => !s || s === '.' || s === '..'))
      raise('high', 'Chemin inconnu.');
    if (
      /^(?:\.github\/|infra\/|scripts\/|packages\/storage\/|apps\/(?:api|runner-supervisor|github-bridge|workflow-worker)\/)/i.test(
        p,
      ) ||
      /(?:^|\/)(?:package(?:-lock)?\.json|.*lock.*|docker-compose.*|AGENTS\.md|CLAUDE\.md|.*auth.*|.*permission.*|.*policy.*|.*secret.*)$/i.test(
        p,
      )
    )
      raise('high', 'Infrastructure, dépendances, données ou contrôle des accès.');
    else if (!(p === 'README.md' || /^docs\/[A-Za-z0-9_./-]+\.md$/.test(p)))
      raise('medium', 'Fichier hors du périmètre documentaire connu.');
    if (
      !['added', 'modified', 'removed'].includes(f.status) ||
      typeof f.patch !== 'string' ||
      f.changes !== f.additions + f.deletions
    )
      raise('high', 'Diff incomplet, binaire ou renommage : examen dédié nécessaire.');
  }
  if (files.length > 10 || lines > 300)
    raise('medium', 'Seuil documentaire dépassé (10 fichiers ou 300 lignes).');
  if (!reasons.length)
    reasons.push(
      'Documentation uniquement, sans autorisation de déploiement automatique à ce stade.',
    );
  return { level, reasons, files: files.length, lines };
}
// All reads are bound to the published commit. This observer never merges or deploys.
export async function qualify(bridge, input, policy) {
  const { repository: repo, commit, base_commit: base, number, branch, digest, id } = input;
  if (
    !/^[a-f0-9]{40}$/.test(commit ?? '') ||
    !/^[a-f0-9]{40}$/.test(base ?? '') ||
    !Number.isSafeInteger(number) ||
    number < 1 ||
    !/^[a-f0-9]{64}$/.test(digest ?? '') ||
    !/^[a-f0-9-]{36}$/.test(id ?? '')
  )
    throw new Error('github_invalid_request');
  const token = await bridge.auth.token();
  const route = `/repos/${repo}`;
  const get = (path) => bridge.api(route + path, undefined, token);
  const report = {
    state: 'blocked',
    commit,
    base_commit: base,
    patch_digest: digest,
    policy_version: policyVersion,
    policy_digest: policy.digest,
    checked_at: new Date().toISOString(),
    blockers: [],
    risk: null,
    checks: [],
    run: null,
    deploy_allowed: false,
  };
  const block = (text) => report.blockers.push(text);
  const pull = await get(`/pulls/${number}`);
  const matches = (p) =>
    p.head?.sha === commit &&
    p.head?.ref === `jarvis/${id}` &&
    p.head?.repo?.full_name?.toLowerCase() === repo.toLowerCase() &&
    p.base?.ref === branch &&
    p.base?.repo?.full_name?.toLowerCase() === repo.toLowerCase() &&
    p.base?.sha === base &&
    p.state === 'open' &&
    !p.merged;
  if (!matches(pull)) {
    block(
      'La PR, son commit ou sa branche de départ a changé. Une nouvelle qualification est nécessaire.',
    );
    return report;
  }
  const latest = await bridge.checkRepository(repo, branch);
  if (latest.commit !== base) {
    block('La branche de départ a avancé depuis les tests. Relancez une mission.');
    return report;
  }
  const info = await get(`/git/commits/${commit}`);
  if (info.parents?.length !== 1 || info.parents[0].sha !== base) {
    block('Le commit publié ne correspond plus à la base revue.');
    return report;
  }
  const files = await get(`/pulls/${number}/files?per_page=100`);
  if (!Array.isArray(files) || files.length !== pull.changed_files || files.length > 20) {
    block('Le diff complet ne peut pas être vérifié.');
    return report;
  }
  report.risk = classifyRisk(files);
  const trusted = await Promise.all(
    Object.entries(policy.files).map(async ([p, expected]) => {
      const file = await get(`/contents/${p}?ref=${commit}`);
      return (
        file.type === 'file' &&
        file.encoding === 'base64' &&
        typeof file.content === 'string' &&
        hash(Buffer.from(file.content, 'base64')) === expected
      );
    }),
  );
  if (trusted.some((v) => !v)) {
    block(
      'Le pipeline de préproduction diffère de la version approuvée installée. Mise à jour manuelle du validateur nécessaire.',
    );
    return report;
  }
  const runs = await get(
    `/actions/workflows/ci.yml/runs?head_sha=${commit}&event=push&per_page=100`,
  );
  const candidates = (runs.workflow_runs ?? [])
    .filter(
      (r) =>
        r.head_sha === commit &&
        r.event === 'push' &&
        r.head_branch === `jarvis/${id}` &&
        r.path === '.github/workflows/ci.yml' &&
        r.repository?.full_name?.toLowerCase() === repo.toLowerCase(),
    )
    .sort((a, b) => b.id - a.id);
  const run = candidates[0];
  if (!run) {
    report.state = 'waiting';
    block('Aucune exécution du pipeline approuvé pour ce commit. Vérifiez GitHub Actions.');
    return report;
  }
  if (!Number.isSafeInteger(run.id) || !Number.isSafeInteger(run.run_attempt))
    throw new Error('github_invalid_response');
  report.run = {
    id: run.id,
    attempt: run.run_attempt,
    url: `https://github.com/${repo}/actions/runs/${run.id}`,
  };
  if (run.status !== 'completed') {
    report.state = 'waiting';
    block('Les contrôles GitHub sont encore en cours.');
    return report;
  }
  if (run.conclusion !== 'success') {
    block('Le pipeline GitHub a échoué, a été annulé ou nécessite une intervention.');
    return report;
  }
  const jobs = await get(`/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`);
  for (const name of ['check', 'preproduction']) {
    const found = (jobs.jobs ?? []).filter((j) => j.name === name);
    const passed =
      found.length === 1 &&
      found[0].head_sha === commit &&
      found[0].status === 'completed' &&
      found[0].conclusion === 'success';
    report.checks.push({ name, passed });
    if (!passed) block(`Contrôle ${name} absent ou non réussi sur ce commit.`);
  }
  if (jobs.total_count !== (jobs.jobs ?? []).length)
    block('La liste des contrôles est incomplète.');
  // Detect head/base changes or a re-run while evidence was being collected.
  const [again, head, currentRun] = await Promise.all([
    get(`/pulls/${number}`),
    bridge.checkRepository(repo, branch),
    get(`/actions/runs/${run.id}`),
  ]);
  if (!matches(again) || head.commit !== base)
    block('La PR ou sa base a changé pendant la vérification.');
  if (
    currentRun.run_attempt !== run.run_attempt ||
    currentRun.head_sha !== commit ||
    currentRun.status !== 'completed' ||
    currentRun.conclusion !== 'success'
  )
    block('Les contrôles ont changé pendant la vérification.');
  if (!report.blockers.length) report.state = 'passed';
  return report;
}
