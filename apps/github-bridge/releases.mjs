import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
const sha = (x) => createHash('sha256').update(x).digest('hex');
const validId = (x) =>
  typeof x === 'string' && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(x);
export const deployablePath = (p) =>
  p === 'README.md' ||
  /^docs\/[A-Za-z0-9_./-]+\.md$/.test(p) ||
  /^apps\/web\/(src\/[A-Za-z0-9_./-]+\.(tsx?|css)|public\/[A-Za-z0-9_./-]+\.(svg|png|webmanifest)|index\.html)$/.test(
    p,
  );
export function evidence(report) {
  return sha(
    JSON.stringify({
      commit: report.commit,
      patch: report.patch_digest,
      policy: report.policy_digest,
      run: report.run,
      risk: report.risk,
    }),
  );
}
async function json(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}
async function save(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await fs.writeFile(file + '.tmp', JSON.stringify(data), { mode: 0o600 });
  await fs.rename(file + '.tmp', file);
}
export async function checkRelease(bridge, input) {
  const report = await bridge.qualify(input);
  if (
    report.state !== 'passed' ||
    report.policy_digest !== input.policy_digest ||
    evidence(report) !== input.evidence
  )
    throw new Error('github_release_stale');
  if (report.risk?.level === 'high') throw new Error('github_release_scope');
  const token = await bridge.auth.token();
  const files = await bridge.api(
    `/repos/${input.repository}/pulls/${input.number}/files?per_page=100`,
    undefined,
    token,
  );
  if (
    !files.length ||
    files.length > 20 ||
    files.some((f) => !deployablePath(f.filename) || f.filename.split('/').some((p) => p === '..'))
  )
    throw new Error('github_release_scope');
  return report;
}
export async function exportRelease(bridge, input) {
  if (!validId(input.release_id) || !/^[a-f0-9]{40}$/.test(input.deployed_commit ?? ''))
    throw new Error('github_invalid_request');
  const file = path.join(bridge.sources, 'releases', input.release_id, 'release.json');
  const binding = sha(JSON.stringify(input));
  const old = await json(file).catch(() => null);
  if (old) {
    if (old.binding !== binding) throw new Error('github_conflict');
    return { state: 'succeeded', result: old };
  }
  return bridge.job(`release-export-${input.release_id}`, async () => {
    await checkRelease(bridge, input);
    const token = await bridge.auth.token();
    // Cumulative comparison with the running image also covers recovery after a rollback.
    const compare = await bridge.api(
      `/repos/${input.repository}/compare/${input.deployed_commit}...${input.commit}`,
      undefined,
      token,
    );
    if (
      compare.merge_base_commit?.sha !== input.deployed_commit ||
      compare.status !== 'ahead' ||
      !Array.isArray(compare.files) ||
      compare.files.length > 100 ||
      compare.files.some((f) => !deployablePath(f.filename))
    )
      throw new Error('github_release_scope');
    const bare = path.join(bridge.state, 'repos', input.id);
    await bridge.run(['fetch', '--no-tags', 'origin', input.commit], bare, token);
    const entries = (await bridge.run(['ls-tree', '-rz', '--full-tree', input.commit], bare))
      .toString()
      .split('\0')
      .filter(Boolean);
    if (entries.length > 3000) throw new Error('github_source_limit');
    const destination = path.dirname(file),
      temp = destination + '.tmp';
    await fs.rm(temp, { recursive: true, force: true });
    await fs.mkdir(path.join(temp, 'repo'), { recursive: true });
    let size = 0;
    for (const entry of entries) {
      const m = entry.match(/^(100644|100755) blob ([a-f0-9]{40})\t([^\x00-\x1f\\]+)$/);
      if (!m) throw new Error('github_unsupported_file');
      const [, mode, blob, name] = m;
      const parts = name.split('/');
      if (parts.some((p) => !p || p === '.' || p === '..' || p.toLowerCase() === '.git'))
        throw new Error('github_invalid_path');
      if (
        parts.some(
          (p) =>
            p === 'node_modules' ||
            p === 'dist' ||
            p === 'test-results' ||
            p === 'playwright-report' ||
            p === '.env' ||
            p.startsWith('.env.') ||
            p.endsWith('.log'),
        )
      )
        continue;
      const content = await bridge.run(['cat-file', 'blob', blob], bare);
      size += content.length;
      if (content.length > 2 * 1024 * 1024 || size > 32 * 1024 * 1024)
        throw new Error('github_source_limit');
      const target = path.join(temp, 'repo', name);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, content, { mode: mode === '100755' ? 0o555 : 0o444 });
    }
    const result = {
      binding,
      commit: input.commit,
      deployed_commit: input.deployed_commit,
      release_id: input.release_id,
    };
    await fs.writeFile(path.join(temp, 'release.json'), JSON.stringify(result));
    await fs.rename(temp, destination);
    return result;
  });
}
export async function mergeRelease(bridge, input) {
  if (!validId(input.release_id)) throw new Error('github_invalid_request');
  const file = path.join(bridge.state, 'releases', input.release_id + '.json');
  const binding = sha(JSON.stringify(input));
  const previous = await json(file).catch(() => null);
  if (previous && previous.binding !== binding) throw new Error('github_conflict');
  return bridge.job(`release-merge-${input.release_id}`, async () => {
    let saved = await json(file).catch(() => null);
    if (saved && saved.binding !== binding) throw new Error('github_conflict');
    if (saved?.merged) return saved;
    const token = await bridge.auth.token(),
      route = `/repos/${input.repository}`;
    const [head, pull] = await Promise.all([
      bridge.checkRepository(input.repository, input.branch),
      bridge.api(`${route}/pulls/${input.number}`, undefined, token),
    ]);
    if (
      saved &&
      (head.commit === input.commit ||
        (pull.merged && pull.head?.sha === input.commit && pull.merge_commit_sha === input.commit))
    ) {
      saved.merged = true;
      await save(file, saved);
      return saved;
    }
    const report = await checkRelease(bridge, input);
    if (input.automatic && report.risk.level !== 'low') throw new Error('github_release_scope');
    // Never use the reference API to bypass protected-branch review or ruleset requirements.
    const [branchInfo, rules, repo] = await Promise.all([
      bridge.api(`${route}/branches/${encodeURIComponent(input.branch)}`, undefined, token),
      bridge.api(`${route}/rules/branches/${encodeURIComponent(input.branch)}`, undefined, token),
      bridge.api(route, undefined, token),
    ]);
    if (branchInfo.protected || !Array.isArray(rules) || rules.length)
      throw new Error('github_release_protected');
    if (!repo.node_id || !pull.node_id) throw new Error('github_invalid_response');
    saved = { binding, commit: input.commit, merged: false };
    await save(file, saved);
    const graphql = async (query, variables) => {
      const r = await bridge.api('/graphql', { query, variables }, token);
      if (r.errors?.length) throw new Error('github_release_conflict');
      return r.data;
    };
    if (pull.draft)
      await graphql(
        'mutation($id:ID!){markPullRequestReadyForReview(input:{pullRequestId:$id}){pullRequest{id}}}',
        { id: pull.node_id },
      );
    // Atomic compare-and-swap on BOTH refs; force=false means no rewrite, even on a race.
    await graphql('mutation($input:UpdateRefsInput!){updateRefs(input:$input){clientMutationId}}', {
      input: {
        repositoryId: repo.node_id,
        clientMutationId: input.release_id,
        refUpdates: [
          {
            name: `refs/heads/${input.branch}`,
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
        ],
      },
    });
    saved.merged = true;
    await save(file, saved);
    return saved;
  });
}
