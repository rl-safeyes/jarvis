import test from 'node:test';
import assert from 'node:assert/strict';
import { advance } from '../../apps/release-controller/engine.mjs';
import { mergeRelease, evidence, deployablePath } from '../../apps/github-bridge/releases.mjs';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
function engine(state = 'preparing') {
  let row = { id: 'release', state, automatic: false, artifact: null };
  let now = 0;
  const calls = [];
  const io = {
    save: async (id, state, fields) => (row = { ...row, ...fields, state }),
    now: () => now,
    check: async () => calls.push('check'),
    prepare: async () => ({ image: 'tested', previous_image: 'known' }),
    autoAllowed: async () => false,
    assertTarget: async () => calls.push('target'),
    merge: async () => calls.push('merge'),
    maintenance: async (b) => calls.push('maintenance:' + b),
    promote: async () => calls.push('promote'),
    healthy: async () => calls.push('healthy'),
    rollback: async () => calls.push('rollback'),
    safeError: (e) => e.message,
    note: async () => calls.push('retry'),
  };
  return {
    io,
    calls,
    step: () => advance(row, io),
    row: () => row,
    set: (r) => Object.assign(row, r),
    time: (t) => (now = t),
  };
}
test('deployment prepares first and cannot merge before exact image approval', async () => {
  const f = engine();
  await f.step();
  assert.equal(f.row().state, 'awaiting_approval');
  await f.step();
  assert.ok(!f.calls.includes('merge'));
  f.set({ state: 'queued' });
  await f.step();
  assert.equal(f.row().state, 'monitoring');
  assert.deepEqual(
    f.calls.filter((x) => ['merge', 'promote', 'healthy'].includes(x)),
    ['merge', 'promote', 'healthy'],
  );
  f.time(900000);
  await f.step();
  assert.equal(f.row().state, 'succeeded');
});
test('failed promotion and later regression restore the previous version, failed restoration remains visible', async () => {
  for (const phase of ['promote', 'healthy']) {
    const f = engine('queued');
    f.io[phase] = async () => {
      throw new Error('bad candidate');
    };
    await f.step();
    assert.equal(f.row().state, 'rolled_back');
    assert.ok(f.calls.includes('rollback'));
    assert.equal(f.calls.at(-1), 'maintenance:false');
  }
  const f = engine('deploying');
  f.io.promote = async () => {
    throw new Error('bad');
  };
  f.io.rollback = async () => {
    throw new Error('disk failure');
  };
  await f.step();
  assert.equal(f.row().state, 'rollback_failed');
  assert.notEqual(f.calls.at(-1), 'maintenance:false');
});
test('interrupted merge is reconciled, permanent conflicts block and lost controller lock preserves recovery state', async () => {
  const f = engine('merging');
  f.io.merge = async () => {
    throw new Error('lost response');
  };
  await f.step();
  assert.equal(f.row().state, 'merging');
  assert.ok(f.calls.includes('retry'));
  f.io.merge = async () => {
    throw Object.assign(new Error('github_release_conflict'), { code: 'github_release_conflict' });
  };
  await f.step();
  assert.equal(f.row().state, 'blocked');
  const g = engine('deploying');
  g.io.promote = async () => {
    throw new Error('release_lock_lost');
  };
  await assert.rejects(g.step(), /release_lock_lost/);
  assert.equal(g.row().state, 'deploying');
});
test('automatic mode requires current policy authorization and completed preparation', async () => {
  const f = engine();
  f.set({ automatic: true });
  await f.step();
  await f.step();
  assert.equal(f.row().state, 'awaiting_approval');
  f.io.autoAllowed = async () => true;
  await f.step();
  assert.equal(f.row().state, 'queued');
  for (const p of [
    'packages/storage/migrations/x.sql',
    'apps/api/src/app.ts',
    'package.json',
    'apps/release-controller/main.ts',
  ])
    assert.equal(deployablePath(p), false);
  assert.equal(deployablePath('apps/web/src/styles.css'), true);
});
test('GitHub fusion compares both exact refs atomically, refuses protected branches and recovers a lost response', async (t) => {
  const state = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-release-merge-'));
  t.after(() => fs.rm(state, { recursive: true, force: true }));
  const report = {
    state: 'passed',
    commit: 'b'.repeat(40),
    patch_digest: 'c'.repeat(64),
    policy_digest: 'd'.repeat(64),
    run: { id: 1, attempt: 1 },
    risk: { level: 'low' },
  };
  const input = {
    id: '538c9b34-75ca-4a5d-9b0a-aa3a1098d851',
    release_id: '438c9b34-75ca-4a5d-9b0a-aa3a1098d851',
    repository: 'owner/repo',
    branch: 'main',
    number: 1,
    commit: report.commit,
    base_commit: 'a'.repeat(40),
    policy_digest: report.policy_digest,
    evidence: evidence(report),
  };
  let head = input.base_commit,
    protectedBranch = true,
    updates = 0,
    lose = true;
  const graph = [];
  const bridge = {
    state,
    auth: { token: async () => 'private' },
    qualify: async () => report,
    checkRepository: async () => ({ commit: head }),
    job: async (_, fn) => ({ state: 'succeeded', result: await fn() }),
    api: async (route, body) => {
      if (route === '/graphql') {
        graph.push(body);
        if (body.query.includes('updateRefs')) {
          updates++;
          assert.deepEqual(body.variables.input.refUpdates, [
            {
              name: 'refs/heads/main',
              beforeOid: input.base_commit,
              afterOid: input.commit,
              force: false,
            },
            {
              name: `refs/heads/jarvis/${input.id}`,
              beforeOid: input.commit,
              afterOid: input.commit,
              force: false,
            },
          ]);
          head = input.commit;
          if (lose) {
            lose = false;
            throw new Error('lost response');
          }
        }
        return { data: {} };
      }
      if (route.endsWith('/pulls/1'))
        return { head: { sha: input.commit }, node_id: 'pr', draft: true };
      if (route.includes('/files?')) return [{ filename: 'README.md' }];
      if (route.includes('/rules/')) return [];
      if (route.includes('/branches/')) return { protected: protectedBranch };
      if (route === '/repos/owner/repo') return { node_id: 'repo' };
      throw new Error('unexpected ' + route);
    },
  };
  await assert.rejects(mergeRelease(bridge, input), /github_release_protected/);
  assert.equal(graph.length, 0);
  protectedBranch = false;
  await assert.rejects(mergeRelease(bridge, input), /lost response/);
  assert.equal(updates, 1);
  const result = await mergeRelease(bridge, input);
  assert.equal(result.result.merged, true);
  assert.equal(updates, 1);
  await assert.rejects(
    mergeRelease(bridge, { ...input, commit: 'e'.repeat(40) }),
    /github_conflict/,
  );
});
