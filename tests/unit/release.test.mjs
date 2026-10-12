import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { classifyRisk, qualify } from '../../apps/github-bridge/qualification.mjs';
const sha = 'b'.repeat(40),
  base = 'a'.repeat(40),
  id = '538c9b34-75ca-4a5d-9b0a-aa3a1098d851';
const file = {
  filename: 'README.md',
  status: 'modified',
  additions: 1,
  deletions: 0,
  changes: 1,
  patch: '@@ -1 +1,2 @@\n Base\n+Documentation',
};
const input = {
  id,
  repository: 'owner/repo',
  commit: sha,
  base_commit: base,
  number: 12,
  branch: 'main',
  digest: 'c'.repeat(64),
};
function fixture() {
  const pull = {
    state: 'open',
    merged: false,
    head: { sha, ref: `jarvis/${id}`, repo: { full_name: 'owner/repo' } },
    base: { sha: base, ref: 'main', repo: { full_name: 'owner/repo' } },
    changed_files: 1,
  };
  const run = {
    id: 42,
    run_attempt: 1,
    head_sha: sha,
    head_branch: `jarvis/${id}`,
    event: 'push',
    path: '.github/workflows/ci.yml',
    repository: { full_name: 'owner/repo' },
    status: 'completed',
    conclusion: 'success',
  };
  const jobs = ['check', 'preproduction'].map((name) => ({
    name,
    head_sha: sha,
    status: 'completed',
    conclusion: 'success',
  }));
  const state = {
    pull,
    run,
    jobs,
    files: [{ ...file }],
    base,
    content: 'trusted',
    secondPull: null,
    secondRun: null,
    runs: null,
  };
  let pulls = 0;
  const bridge = {
    auth: { token: async () => 'private' },
    checkRepository: async () => ({ commit: state.base }),
    api: async (p, body, token) => {
      assert.equal(body, undefined, 'qualification must not mutate GitHub');
      assert.equal(token, 'private');
      if (p.endsWith('/pulls/12'))
        return ++pulls > 1 && state.secondPull ? state.secondPull : state.pull;
      if (p.includes('/git/commits/')) return { parents: [{ sha: base }] };
      if (p.includes('/files?')) return state.files;
      if (p.includes('/contents/'))
        return {
          type: 'file',
          encoding: 'base64',
          content: Buffer.from(state.content).toString('base64'),
        };
      if (p.includes('/workflows/ci.yml/runs')) return { workflow_runs: state.runs ?? [state.run] };
      if (p.includes('/jobs?')) return { total_count: state.jobs.length, jobs: state.jobs };
      if (p.endsWith('/runs/42')) return state.secondRun ?? state.run;
      throw new Error('Unexpected request ' + p);
    },
  };
  const policy = {
    files: { '.github/workflows/ci.yml': createHash('sha256').update('trusted').digest('hex') },
    digest: 'd'.repeat(64),
  };
  return { state, check: () => qualify(bridge, input, policy) };
}
test('release risk is conservative for control files, unknown surfaces, binary changes and size', () => {
  assert.equal(classifyRisk([file]).level, 'low');
  assert.equal(classifyRisk([{ ...file, filename: 'docs/usage.md' }]).level, 'low');
  for (const filename of [
    'infra/Dockerfile',
    'package-lock.json',
    'apps/api/src/app.ts',
    'docs/AGENTS.md',
    'docs/auth.md',
    'scripts/preproduction.mjs',
  ])
    assert.equal(classifyRisk([{ ...file, filename }]).level, 'high', filename);
  assert.equal(classifyRisk([{ ...file, filename: 'apps/web/src/main.tsx' }]).level, 'medium');
  assert.equal(classifyRisk([{ ...file, patch: undefined }]).level, 'high');
  assert.equal(classifyRisk([{ ...file, status: 'renamed' }]).level, 'high');
  assert.equal(
    classifyRisk([
      {
        ...file,
        additions: 301,
        changes: 301,
        patch: Array.from({ length: 301 }, () => '+line').join('\n'),
      },
    ]).level,
    'medium',
  );
  assert.equal(classifyRisk([{ ...file, additions: 2, changes: 2 }]).level, 'high');
  assert.equal(classifyRisk([]).level, 'high');
});
test('qualification requires exact commit, approved workflow and successful checks and preproduction', async () => {
  const f = fixture();
  const r = await f.check();
  assert.equal(r.state, 'passed');
  assert.equal(r.risk.level, 'low');
  assert.equal(r.commit, sha);
  assert.equal(r.deploy_allowed, false);
  assert.deepEqual(
    r.checks.map((c) => c.passed),
    [true, true],
  );
});
test('qualification fails closed on skipped, missing, stale, foreign or modified evidence', async () => {
  for (const mutate of [
    (s) => (s.jobs[1].conclusion = 'skipped'),
    (s) => s.jobs.pop(),
    (s) => (s.jobs[0].head_sha = base),
    (s) => (s.content = 'changed workflow'),
    (s) => (s.base = 'e'.repeat(40)),
    (s) => (s.pull.head.sha = base),
    (s) => (s.pull.head.repo.full_name = 'fork/repo'),
    (s) => (s.pull.changed_files = 2),
    (s) => (s.run.conclusion = 'failure'),
    (s) => (s.secondPull = { ...s.pull, state: 'closed' }),
    (s) => (s.secondRun = { ...s.run, run_attempt: 2 }),
  ]) {
    const f = fixture();
    mutate(f.state);
    assert.equal((await f.check()).state, 'blocked');
  }
});
test('missing and running pipelines remain pending, newest run replaces older successful evidence', async () => {
  for (const mutate of [
    (s) => (s.runs = []),
    (s) => (s.run.status = 'in_progress'),
    (s) => (s.run.head_branch = 'unrelated'),
    (s) => (s.run.event = 'pull_request'),
  ]) {
    const f = fixture();
    mutate(f.state);
    assert.equal((await f.check()).state, 'waiting');
  }
  const f = fixture();
  f.state.runs = [f.state.run, { ...f.state.run, id: 43, conclusion: 'failure' }];
  assert.equal((await f.check()).state, 'blocked');
});
