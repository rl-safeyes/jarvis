import { qualify, trustedPolicy } from './qualification.mjs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
export const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const uuid = (value) =>
  typeof value === 'string' && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
export function repository(value) {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/.test(value) ||
    value.endsWith('/..') ||
    value.endsWith('/.')
  )
    throw new Error('github_invalid_repository');
  return value;
}
export function branch(value) {
  if (
    typeof value !== 'string' ||
    value.length > 150 ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value) ||
    value.includes('..') ||
    value.includes('//') ||
    value.endsWith('/') ||
    value.endsWith('.') ||
    value.split('/').some((x) => x.startsWith('.') || x.endsWith('.lock'))
  )
    throw new Error('github_invalid_branch');
  return value;
}
export function sourcePath(value) {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 240 ||
    /[\x00-\x1f\\]/.test(value) ||
    value.split('/').some((x) => !x || x === '.' || x === '..' || x.toLowerCase() === '.git')
  )
    throw new Error('github_invalid_path');
  return value;
}
const excluded = (name) =>
  name
    .split('/')
    .some(
      (x) =>
        ['node_modules', 'dist', 'test-results', 'playwright-report', '.env'].includes(x) ||
        x.startsWith('.env.') ||
        x.endsWith('.log'),
    );
export async function atomic(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data), { mode: 0o600 });
  await fs.rename(tmp, file);
}
const readJson = async (file) => JSON.parse(await fs.readFile(file, 'utf8'));
export async function git(args, cwd, token, timeout = 120000) {
  return new Promise((resolve, reject) => {
    const p = spawn(
      'git',
      [
        '-c',
        'core.hooksPath=/dev/null',
        '-c',
        'credential.helper=',
        '-c',
        'protocol.file.allow=never',
        '-c',
        'protocol.ext.allow=never',
        '-c',
        'core.attributesFile=/dev/null',
        '-c',
        'http.followRedirects=false',
        ...args,
      ],
      {
        cwd,
        env: {
          PATH: process.env.PATH,
          HOME: '/tmp',
          LANG: 'C.UTF-8',
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_CONFIG_GLOBAL: '/dev/null',
          GIT_TERMINAL_PROMPT: '0',
          GIT_LFS_SKIP_SMUDGE: '1',
          GIT_ASKPASS: '/opt/github/askpass.mjs',
          JARVIS_GITHUB_TOKEN: token ?? '',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      },
    );
    const chunks = [];
    let size = 0;
    let overflow = false;
    const stop = () => {
      try {
        process.kill(-p.pid, 'SIGKILL');
      } catch {}
    };
    const timer = setTimeout(stop, timeout);
    p.stdout.on('data', (b) => {
      size += b.length;
      if (size > 40 * 1024 * 1024) {
        overflow = true;
        stop();
      } else chunks.push(b);
    });
    p.stderr.resume();
    p.once('error', () => {
      clearTimeout(timer);
      reject(new Error('github_git_failed'));
    });
    p.once('close', (code) => {
      clearTimeout(timer);
      code === 0 && !overflow
        ? resolve(Buffer.concat(chunks))
        : reject(new Error('github_git_failed'));
    });
  });
}
export class GitHubBridge {
  constructor({
    state = '/state',
    sources = '/sources',
    auth,
    request = fetch,
    run = git,
    remote = (repo) => `https://github.com/${repo}.git`,
  }) {
    Object.assign(this, { state, sources, auth, request, run, remote });
    this.jobs = new Map();
    this.queue = Promise.resolve();
  }
  async api(route, body, token, allow404 = false) {
    const response = await this.request(`https://api.github.com${route}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'Jarvis',
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30000),
      redirect: 'error',
    });
    if (allow404 && response.status === 404) return null;
    if (!response.ok)
      throw new Error(
        response.status === 401
          ? 'github_disconnected'
          : response.status === 403
            ? 'github_permission'
            : response.status === 404
              ? 'github_repository_missing'
              : response.status === 422
                ? 'github_conflict'
                : 'github_unavailable',
      );
    return response.json();
  }
  async qualify(input) {
    repository(input.repository);
    branch(input.branch);
    const policy = await trustedPolicy(
      process.env.JARVIS_TRUSTED_ROOT ? new URL(process.env.JARVIS_TRUSTED_ROOT) : undefined,
    );
    return qualify(this, input, policy);
  }
  async checkRepository(repo, base) {
    repository(repo);
    branch(base);
    const token = await this.auth.token();
    const info = await this.api(`/repos/${repo}`, undefined, token);
    if (info.archived || info.disabled || !info.permissions?.push)
      throw new Error('github_permission');
    const ref = await this.api(
      `/repos/${repo}/git/ref/heads/${base.split('/').map(encodeURIComponent).join('/')}`,
      undefined,
      token,
    );
    if (!/^[a-f0-9]{40}$/.test(ref?.object?.sha ?? '')) throw new Error('github_invalid_response');
    return {
      repository: repo,
      branch: base,
      commit: ref.object.sha,
      private: Boolean(info.private),
    };
  }
  async snapshot(input) {
    if (!uuid(input.id)) throw new Error('github_invalid_request');
    repository(input.repository);
    branch(input.branch);
    const destination = path.join(this.sources, input.id);
    const metadata = path.join(destination, 'source.json');
    const existing = await readJson(metadata).catch(() => null);
    if (existing) {
      if (existing.repository !== input.repository || existing.branch !== input.branch)
        throw new Error('github_conflict');
      return { state: 'succeeded', result: existing };
    }
    return this.job(`snapshot-${input.id}`, async () => {
      const info = await this.checkRepository(input.repository, input.branch);
      const token = await this.auth.token();
      const bare = path.join(this.state, 'repos', input.id);
      await fs.mkdir(path.dirname(bare), { recursive: true });
      if (!(await fs.stat(path.join(bare, 'HEAD')).catch(() => null))) {
        await fs.rm(bare, { recursive: true, force: true });
        await this.run(
          [
            'clone',
            '--bare',
            '--no-local',
            '--single-branch',
            '--depth',
            '1',
            '--branch',
            input.branch,
            '--',
            this.remote(input.repository),
            bare,
          ],
          this.state,
          token,
        );
      }
      const exists = await this.run(['cat-file', '-t', info.commit], bare).catch(() => null);
      if (!exists) await this.run(['fetch', '--no-tags', 'origin', info.commit], bare, token);
      const tree = (await this.run(['ls-tree', '-rz', '--full-tree', info.commit], bare))
        .toString('utf8')
        .split('\0')
        .filter(Boolean);
      if (tree.length > 3000) throw new Error('github_source_limit');
      const temp = `${destination}.tmp`;
      await fs.rm(temp, { recursive: true, force: true });
      await fs.mkdir(path.join(temp, 'repo'), { recursive: true, mode: 0o755 });
      let size = 0;
      const manifest = [];
      for (const entry of tree) {
        const m = entry.match(/^(\d{6}) (\w+) ([a-f0-9]{40})\t([\s\S]+)$/);
        if (!m) throw new Error('github_invalid_path');
        const [, mode, type, sha, name] = m;
        sourcePath(name);
        if (excluded(name)) continue;
        if (type !== 'blob' || !['100644', '100755'].includes(mode))
          throw new Error('github_unsupported_file');
        const content = await this.run(['cat-file', 'blob', sha], bare);
        size += content.length;
        if (size > 32 * 1024 * 1024 || content.length > 2 * 1024 * 1024)
          throw new Error('github_source_limit');
        const target = path.join(temp, 'repo', name);
        await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o755 });
        await fs.writeFile(target, content, { mode: mode === '100755' ? 0o555 : 0o444 });
        manifest.push({ path: name, mode, sha });
      }
      const result = {
        ...info,
        snapshot_id: input.id,
        manifest_digest: sha256(JSON.stringify(manifest)),
        created_at: new Date().toISOString(),
      };
      await fs.writeFile(path.join(temp, 'source.json'), JSON.stringify(result), { mode: 0o444 });
      await fs.rename(temp, destination);
      return result;
    });
  }
  job(key, operation) {
    let job = this.jobs.get(key);
    if (!job) {
      job = { state: 'running' };
      this.jobs.set(key, job);
      const task = this.queue.then(operation);
      this.queue = task.catch(() => {});
      task
        .then((result) => Object.assign(job, { state: 'succeeded', result }))
        .catch((error) =>
          Object.assign(job, {
            state: 'failed',
            error_code: /^github_[a-z_]+$/.test(error.message ?? '')
              ? error.message
              : 'github_unavailable',
          }),
        );
    }
    const output = { ...job };
    if (job.state === 'failed') this.jobs.delete(key);
    return output;
  }
  async publish(input) {
    if (
      !uuid(input.id) ||
      typeof input.patch !== 'string' ||
      input.patch.length > 100000 ||
      !input.patch ||
      sha256(input.patch) !== input.digest ||
      typeof input.title !== 'string' ||
      input.title.length > 180 ||
      typeof input.body !== 'string' ||
      input.body.length > 12000
    )
      throw new Error('github_invalid_request');
    const source = await readJson(path.join(this.sources, input.id, 'source.json')).catch(
      () => null,
    );
    if (
      !source ||
      source.commit !== input.base_commit ||
      source.repository !== input.repository ||
      source.branch !== input.branch
    )
      throw new Error('github_source_missing');
    const fingerprint = sha256(JSON.stringify(input));
    const journal = path.join(this.state, 'publications', `${input.id}.json`);
    let saved = await readJson(journal).catch(() => null);
    if (saved && saved.fingerprint !== fingerprint) throw new Error('github_conflict');
    if (saved?.result) return { state: 'succeeded', result: saved.result };
    return this.job(`publish-${input.id}`, async () => {
      saved = await readJson(journal).catch(() => null);
      if (!saved) {
        saved = { fingerprint, created_at: new Date().toISOString() };
        await atomic(journal, saved);
      }
      const token = await this.auth.token();
      const generation = this.auth.generation;
      const checkAuth = () => {
        if (generation !== this.auth.generation) throw new Error('github_disconnected');
      };
      const repo = source.repository;
      const head = `jarvis/${input.id}`;
      const route = `/repos/${repo}`;
      // Reconcile a lost PR response before checking a base that might have advanced since publication.
      const pulls = await this.api(
        `${route}/pulls?state=all&head=${encodeURIComponent(repo.split('/')[0] + ':' + head)}&base=${encodeURIComponent(source.branch)}`,
        undefined,
        token,
      );
      if (pulls.length) {
        if (pulls.length !== 1 || !saved.commit || pulls[0].head.sha !== saved.commit)
          throw new Error('github_conflict');
        saved.result = this.prResult(pulls[0], saved.commit);
        await atomic(journal, saved);
        return saved.result;
      }
      const latest = await this.checkRepository(repo, source.branch);
      if (latest.commit !== source.commit) throw new Error('github_base_changed');
      const bare = path.join(this.state, 'repos', input.id);
      const work = path.join(this.state, 'work', input.id);
      if (!saved.commit) {
        await fs.rm(work, { recursive: true, force: true });
        await fs.mkdir(work, { recursive: true });
        // Reconstruct tracked files without checkout hooks, submodules, filters or repository commands.
        await fs.cp(path.join(this.sources, input.id, 'repo'), work, { recursive: true });
        await this.run(['init'], work);
        await this.run(['add', '--force', '.'], work);
        await this.run(
          [
            '-c',
            'user.name=Jarvis',
            '-c',
            'user.email=jarvis@localhost',
            'commit',
            '-m',
            'Reference',
          ],
          work,
        );
        const patchFile = path.join(this.state, 'work', `${input.id}.patch`);
        await fs.writeFile(patchFile, input.patch, { mode: 0o600 });
        await this.run(['apply', '--check', '--binary', '--', patchFile], work);
        await this.run(['apply', '--binary', '--', patchFile], work);
        await this.run(['add', '--force', '-A'], work);
        const changed = (
          await this.run(['diff', '--cached', '--name-only', '-z', '--no-renames'], work)
        )
          .toString('utf8')
          .split('\0')
          .filter(Boolean);
        if (!changed.length || changed.length > 20) throw new Error('github_invalid_patch');
        const files = [];
        for (const name of changed) {
          sourcePath(name);
          if (
            excluded(name) ||
            name.startsWith('.github/') ||
            ['.gitattributes', '.gitmodules'].includes(name)
          )
            throw new Error('github_protected_path');
          const st = await fs.lstat(path.join(work, name)).catch(() => null);
          if (st && !st.isFile()) throw new Error('github_unsupported_file');
          if (st && st.size > 2 * 1024 * 1024) throw new Error('github_source_limit');
          if (!st) {
            files.push({ path: name, mode: '100644', type: 'blob', sha: null });
            continue;
          }
          const content = await fs.readFile(path.join(work, name));
          const blob = await this.api(
            `${route}/git/blobs`,
            { content: content.toString('base64'), encoding: 'base64' },
            token,
          );
          files.push({
            path: name,
            mode: st.mode & 0o111 ? '100755' : '100644',
            type: 'blob',
            sha: blob.sha,
          });
        }
        const original = await this.api(`${route}/git/commits/${source.commit}`, undefined, token);
        const tree = await this.api(
          `${route}/git/trees`,
          { base_tree: original.tree.sha, tree: files },
          token,
        );
        // Fixed date and message make retrying commit creation content-addressed and deterministic.
        const identity = { name: 'Jarvis', email: 'jarvis@localhost', date: saved.created_at };
        const commit = await this.api(
          `${route}/git/commits`,
          {
            message: `${input.title}\n\nJarvis-Change: ${input.id}\nPatch-SHA256: ${input.digest}`,
            tree: tree.sha,
            parents: [source.commit],
            author: identity,
            committer: identity,
          },
          token,
        );
        saved.commit = commit.sha;
        await atomic(journal, saved);
      }
      checkAuth();
      const headRef = await this.api(`${route}/git/ref/heads/${head}`, undefined, token, true);
      if (headRef && headRef.object.sha !== saved.commit) throw new Error('github_branch_conflict');
      if ((await this.checkRepository(repo, source.branch)).commit !== source.commit)
        throw new Error('github_base_changed');
      if (!headRef)
        await this.api(
          `${route}/git/refs`,
          { ref: `refs/heads/${head}`, sha: saved.commit },
          token,
        );
      checkAuth();
      const pull = await this.api(
        `${route}/pulls`,
        { title: input.title, body: input.body, head, base: source.branch, draft: true },
        token,
      );
      saved.result = this.prResult(pull, saved.commit);
      await atomic(journal, saved);
      await fs.rm(work, { recursive: true, force: true });
      return saved.result;
    });
  }
  prResult(pull, commit) {
    if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/\d+$/.test(pull.html_url))
      throw new Error('github_invalid_response');
    return {
      url: pull.html_url,
      number: pull.number,
      commit,
      branch: pull.head.ref,
      state: pull.state,
      draft: pull.draft,
    };
  }
}
