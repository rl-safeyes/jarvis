import { evidence } from '../../apps/github-bridge/releases.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  GitHubBridge,
  sha256,
  repository,
  branch,
  sourcePath,
} from '../../apps/github-bridge/github.mjs';
const execute = promisify(execFile);
const ID = '538c9b34-75ca-4a5d-9b0a-aa3a1098d851';
const ID2 = 'ee424e71-330f-4b87-9a4b-56ee62d64eb2';
const run = async (args, cwd) =>
  Buffer.from(
    (
      await execute(
        'git',
        [
          '-c',
          'core.hooksPath=/dev/null',
          '-c',
          'user.name=Fixture',
          '-c',
          'user.email=fixture@example.test',
          ...args,
        ],
        { cwd, encoding: 'buffer' },
      )
    ).stdout,
  );
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-github-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const remote = path.join(root, 'remote');
  await fs.mkdir(remote);
  await run(['init', '-b', 'main'], remote);
  await fs.writeFile(path.join(remote, 'README.md'), 'Base\n');
  await fs.writeFile(path.join(remote, 'package-lock.json'), '{}\n');
  await fs.writeFile(path.join(remote, '.env.example'), 'PRESERVED=yes\n');
  await run(['add', '.'], remote);
  await run(['commit', '-m', 'Reference'], remote);
  const commit = (await run(['rev-parse', 'HEAD'], remote)).toString().trim();
  const state = path.join(root, 'state');
  const sources = path.join(root, 'sources');
  await fs.mkdir(state);
  await fs.mkdir(sources);
  const calls = [];
  let ref = null;
  let pull = null;
  let base = commit;
  let lose = false;
  let deny = false;
  const auth = {
    generation: 0,
    token: async () => {
      if (deny) throw new Error('github_disconnected');
      return 'fixture-private-token';
    },
  };
  const request = async (url, init) => {
    const u = new URL(url);
    assert.equal(u.origin, 'https://api.github.com');
    assert.equal(init.headers.Authorization, 'Bearer fixture-private-token');
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ path: u.pathname, method: init.method, body });
    let result;
    if (u.pathname === '/repos/owner/repo') result = { permissions: { push: true }, private: true };
    else if (u.pathname.endsWith('/git/ref/heads/main')) result = { object: { sha: base } };
    else if (u.pathname.includes('/git/ref/heads/jarvis/')) {
      if (!ref) return new Response('{}', { status: 404 });
      result = { object: { sha: ref } };
    } else if (u.pathname.endsWith('/pulls') && init.method === 'GET') result = pull ? [pull] : [];
    else if (u.pathname.endsWith('/git/blobs')) result = { sha: sha256(body.content).slice(0, 40) };
    else if (u.pathname.includes('/git/commits/') && init.method === 'GET')
      result = { tree: { sha: 'a'.repeat(40) } };
    else if (u.pathname.endsWith('/git/trees')) result = { sha: 'b'.repeat(40) };
    else if (u.pathname.endsWith('/git/commits')) result = { sha: 'c'.repeat(40) };
    else if (u.pathname.endsWith('/git/refs')) {
      assert.equal(body.ref, `refs/heads/jarvis/${ID}`);
      assert.equal(ref, null);
      ref = body.sha;
      result = { object: { sha: ref } };
    } else if (u.pathname.endsWith('/pulls') && init.method === 'POST') {
      assert.equal(body.draft, true);
      assert.equal(body.base, 'main');
      pull = {
        number: 12,
        html_url: 'https://github.com/owner/repo/pull/12',
        head: { sha: ref, ref: body.head },
        state: 'open',
        draft: true,
      };
      result = pull;
      if (lose) {
        lose = false;
        throw new Error('Connection lost after GitHub created the PR');
      }
    } else throw new Error('Unexpected API route ' + u.pathname);
    return Response.json(result);
  };
  const create = () =>
    new GitHubBridge({ state, sources, auth, request, run, remote: () => remote });
  const bridge = create();
  async function finish(action) {
    for (let i = 0; i < 300; i++) {
      const result = await action();
      if (result.state !== 'running') return result;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('Timeout');
  }
  const snapshot = await finish(() =>
    bridge.snapshot({ id: ID, repository: 'owner/repo', branch: 'main' }),
  );
  assert.equal(snapshot.state, 'succeeded', JSON.stringify(snapshot));
  await fs.writeFile(path.join(remote, 'README.md'), 'Base\nProposition\n');
  const patch = (await run(['diff', '--binary'], remote)).toString();
  const input = {
    id: ID,
    repository: 'owner/repo',
    branch: 'main',
    base_commit: commit,
    patch,
    digest: sha256(patch),
    title: 'Ajouter une explication',
    body: 'Tests réussis et revue favorable.',
  };
  return {
    root,
    remote,
    bridge,
    create,
    finish,
    input,
    calls,
    sources,
    auth,
    commit,
    setBase: (value) => {
      base = value;
    },
    loseNextResponse: () => {
      lose = true;
    },
    revoke: () => {
      deny = true;
      auth.generation++;
    },
  };
}
test('GitHub paths and repository names reject injection and traversal', () => {
  for (const x of [
    'https://github.com/owner/repo',
    'owner/repo.git/extra',
    'owner/../repo',
    'owner/.',
  ])
    assert.throws(() => repository(x));
  for (const x of ['--upload-pack=x', 'main..secret', 'main.lock', 'a//b', 'a/.b', 'main\n'])
    assert.throws(() => branch(x));
  for (const x of ['../auth/hosts.yml', '/absolute', '.git/config', 'a/../../auth', 'a\\b'])
    assert.throws(() => sourcePath(x));
  assert.equal(repository('rl-safeyes/jarvis'), 'rl-safeyes/jarvis');
  assert.equal(branch('feature/example'), 'feature/example');
});
test('GitHub snapshot pins a real commit and publication preserves untouched files', async (t) => {
  const f = await fixture(t);
  const snapshot = JSON.parse(await fs.readFile(path.join(f.sources, ID, 'source.json')));
  assert.equal(snapshot.commit, f.commit);
  await assert.rejects(fs.access(path.join(f.sources, ID, 'repo', '.env.example')));
  const publication = await f.finish(() => f.bridge.publish(f.input));
  assert.equal(publication.state, 'succeeded', JSON.stringify(publication));
  const tree = f.calls.find((c) => c.path.endsWith('/git/trees')).body;
  assert.equal(tree.base_tree, 'a'.repeat(40));
  assert.deepEqual(
    tree.tree.map((f) => f.path),
    ['README.md'],
  );
  const payload = f.calls.find((c) => c.path.endsWith('/git/blobs')).body;
  assert.equal(Buffer.from(payload.content, 'base64').toString(), 'Base\nProposition\n');
  const commit = f.calls.find((c) => c.path.endsWith('/git/commits') && c.method === 'POST').body;
  assert.deepEqual(commit.parents, [f.commit]);
  assert.ok(!JSON.stringify(publication).includes('fixture-private-token'));
  const repeat = await f.create().publish(f.input);
  assert.equal(repeat.result.url, publication.result.url);
  assert.equal(f.calls.filter((c) => c.path.endsWith('/pulls') && c.method === 'POST').length, 1);
});
test('lost PR response is reconciled after restart without another branch or PR', async (t) => {
  const f = await fixture(t);
  f.loseNextResponse();
  const failed = await f.finish(() => f.bridge.publish(f.input));
  assert.equal(failed.state, 'failed');
  f.setBase('d'.repeat(40));
  const recovered = await f.finish(() => f.create().publish(f.input));
  assert.equal(recovered.state, 'succeeded', JSON.stringify(recovered));
  assert.equal(
    f.calls.filter((c) => c.path.endsWith('/git/refs') && c.method === 'POST').length,
    1,
  );
  assert.equal(f.calls.filter((c) => c.path.endsWith('/pulls') && c.method === 'POST').length, 1);
});
test('changed base, corrupted digest, protected workflows and revoked auth block publication', async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    f.bridge.publish({ ...f.input, digest: '0'.repeat(64) }),
    /github_invalid_request/,
  );
  f.setBase('d'.repeat(40));
  let r = await f.finish(() => f.bridge.publish(f.input));
  assert.equal(r.error_code, 'github_base_changed');
  f.setBase(f.commit);
  const original = await fs.readFile(path.join(f.root, 'state', 'publications', `${ID}.json`));
  assert.ok(!original.toString().includes('fixture-private-token'));
  const workflow =
    'diff --git a/.github/workflows/unsafe.yml b/.github/workflows/unsafe.yml\nnew file mode 100644\n--- /dev/null\n+++ b/.github/workflows/unsafe.yml\n@@ -0,0 +1 @@\n+danger\n';
  // A new isolated proposal needs its own immutable source and journal.
  await fs.cp(path.join(f.sources, ID), path.join(f.sources, ID2), { recursive: true });
  const p = { ...f.input, id: ID2, patch: workflow, digest: sha256(workflow) };
  r = await f.finish(() => f.bridge.publish(p));
  assert.equal(r.error_code, 'github_protected_path');
  f.revoke();
  r = await f.finish(() => f.bridge.publish(f.input));
  assert.equal(r.error_code, 'github_disconnected');
  assert.equal(f.calls.filter((c) => c.path.endsWith('/git/refs')).length, 0);
});

test('release source exports the exact reviewed tree without credentials and rejects cumulative backend changes', async (t) => {
  const f = await fixture(t);
  await run(['add', 'README.md'], f.remote);
  await run(['commit', '-m', 'Candidate'], f.remote);
  const commit = (await run(['rev-parse', 'HEAD'], f.remote)).toString().trim();
  const report = {
    state: 'passed',
    commit,
    patch_digest: f.input.digest,
    policy_digest: 'd'.repeat(64),
    run: { id: 1, attempt: 1 },
    risk: { level: 'low' },
  };
  let changed = 'README.md';
  f.bridge.qualify = async () => report;
  f.bridge.api = async (route) =>
    route.includes('/compare/')
      ? { status: 'ahead', merge_base_commit: { sha: f.commit }, files: [{ filename: changed }] }
      : [{ filename: 'README.md' }];
  const input = {
    ...f.input,
    commit,
    release_id: ID2,
    deployed_commit: f.commit,
    policy_digest: report.policy_digest,
    evidence: evidence(report),
  };
  const result = await f.finish(() => f.bridge.exportRelease(input));
  assert.equal(result.state, 'succeeded', JSON.stringify(result));
  const dir = path.join(f.sources, 'releases', ID2, 'repo');
  assert.equal(await fs.readFile(path.join(dir, 'README.md'), 'utf8'), 'Base\nProposition\n');
  await assert.rejects(fs.access(path.join(dir, '.env.example')));
  await assert.rejects(fs.access(path.join(dir, '.git')));
  assert.equal((await fs.stat(path.join(dir, 'README.md'))).mode & 0o222, 0);
  assert.equal((await f.bridge.exportRelease(input)).result.commit, commit);
  await assert.rejects(
    f.bridge.exportRelease({ ...input, deployed_commit: 'f'.repeat(40) }),
    /github_conflict/,
  );
  changed = 'packages/storage/migrations/unsafe.sql';
  const blocked = await f.finish(() =>
    f.bridge.exportRelease({ ...input, release_id: '638c9b34-75ca-4a5d-9b0a-aa3a1098d851' }),
  );
  assert.equal(blocked.error_code, 'github_release_scope');
});
