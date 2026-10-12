// Runs exclusively in a disposable, non-networked container without account volumes.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
const input = JSON.parse(Buffer.from(process.argv[2], 'base64').toString());
const root = '/workspace/repo',
  reference = '/opt/reference';
const excluded = new Set(['.git', 'node_modules', 'dist', 'test-results', 'playwright-report']);
const limit = 32 * 1024 * 1024;
async function files(dir, prefix = '', result = []) {
  for (const item of await fs.readdir(dir, { withFileTypes: true })) {
    if (excluded.has(item.name)) continue;
    if (item.name === '.env' || item.name.startsWith('.env.') || item.name.endsWith('.log'))
      continue;
    const name = prefix + item.name;
    if (item.isSymbolicLink() || (!item.isFile() && !item.isDirectory()))
      throw new Error('Fichiers spéciaux et liens symboliques refusés.');
    if (item.isDirectory()) await files(path.join(dir, item.name), name + '/', result);
    else result.push(name);
    if (result.length > 3000) throw new Error('Limite de fichiers dépassée.');
  }
  return result.sort();
}
async function copySource(from, to) {
  await fs.mkdir(to, { recursive: true });
  let bytes = 0;
  for (const name of await files(from)) {
    const st = await fs.lstat(path.join(from, name));
    bytes += st.size;
    if (bytes > limit || st.size > 2 * 1024 * 1024)
      throw new Error('Limite de taille du code dépassée.');
    await fs.mkdir(path.dirname(path.join(to, name)), { recursive: true });
    await fs.copyFile(path.join(from, name), path.join(to, name));
  }
}
async function dependencies(target) {
  const dir = target + '/node_modules';
  await fs.mkdir(dir, { recursive: true });
  for (const name of await fs.readdir(reference + '/node_modules')) {
    if (name === '@jarvis') continue;
    await fs.symlink(reference + '/node_modules/' + name, dir + '/' + name);
  }
  await fs.mkdir(dir + '/@jarvis');
  for (const name of await fs.readdir(reference + '/node_modules/@jarvis')) {
    const original = await fs.realpath(reference + '/node_modules/@jarvis/' + name);
    const relative = path.relative(reference, original);
    if (relative.startsWith('..')) throw new Error('Invalid workspace dependency');
    await fs.symlink(target + '/' + relative, dir + '/@jarvis/' + name);
  }
}
async function safe(relative, writing = false) {
  if (
    typeof relative !== 'string' ||
    relative.length > 240 ||
    relative.startsWith('/') ||
    /[\x00-\x1f\\]/.test(relative)
  )
    throw new Error('Chemin refusé.');
  const parts = relative.split('/');
  if (
    parts.some(
      (p) =>
        !p || p === '.' || p === '..' || excluded.has(p) || p === '.env' || p.startsWith('.env.'),
    )
  )
    throw new Error('Chemin refusé.');
  let current = root;
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    const st = await fs.lstat(current).catch((e) => {
      if (e.code !== 'ENOENT') throw e;
      return null;
    });
    if (st?.isSymbolicLink() || (st && !(st.isFile() || st.isDirectory())))
      throw new Error('Lien ou fichier spécial refusé.');
    if (!st && i < parts.length - 1 && writing) await fs.mkdir(current);
  }
  return current;
}
function command(command, args, cwd = root, timeout = 90000, outputSize = 16000) {
  return new Promise((resolve, reject) => {
    const p = spawn(command, args, {
      cwd,
      env: {
        PATH: process.env.PATH,
        HOME: '/tmp/home',
        LANG: 'C.UTF-8',
        CI: '1',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_TERMINAL_PROMPT: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    let output = '',
      overflow = false,
      timedOut = false;
    const kill = () => {
      try {
        process.kill(-p.pid, 'SIGKILL');
      } catch {
        p.kill('SIGKILL');
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, timeout);
    for (const stream of [p.stdout, p.stderr])
      stream.on('data', (b) => {
        output += b.toString();
        if (output.length > 120000) {
          overflow = true;
          output = output.slice(0, 120000);
          kill();
        }
      });
    p.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    p.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        exit_code: code ?? -1,
        output: output.slice(-outputSize),
        timed_out: timedOut,
        output_limit: overflow,
      });
    });
  });
}
async function git(args, cwd = root) {
  const r = await command(
    'git',
    [
      '-c',
      'core.hooksPath=/dev/null',
      '-c',
      'user.name=Jarvis',
      '-c',
      'user.email=jarvis@localhost',
      ...args,
    ],
    cwd,
  );
  if (r.exit_code !== 0) throw new Error('Échec de l’opération Git.');
  return r.output.trim();
}
async function execute() {
  await fs.mkdir('/tmp/home', { recursive: true });
  if (input.tool === 'initialize') {
    // A failed initialization is never retried under a different operation id.
    await copySource(reference, root);
    await dependencies(root);
    await git(['init', '-b', `jarvis/${input.change_id}`]);
    await git(['add', '--force', '--', '.', ':(exclude)node_modules']);
    await git(['commit', '-m', 'Reference Jarvis']);
    return {
      message: 'Copie isolée prête. Git, gh, Node et npm disponibles ; réseau désactivé.',
      files: await files(root),
    };
  }
  const rootStat = await fs.lstat(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory())
    throw new Error('Racine de travail invalide.');
  if (input.tool === 'list') {
    const base = input.path ? await safe(input.path) : root;
    return { files: (await files(base)).slice(0, 600) };
  }
  if (input.tool === 'read') {
    const target = await safe(input.path);
    const stat = await fs.stat(target);
    if (stat.size > 2000000) throw new Error('Fichier trop volumineux.');
    const data = await fs.readFile(target, 'utf8');
    return {
      content: data.slice(input.offset ?? 0, (input.offset ?? 0) + 16000),
      length: data.length,
    };
  }
  if (input.tool === 'write') {
    if (typeof input.content !== 'string' || input.content.length > 60000)
      throw new Error('Contenu trop volumineux.');
    await fs.writeFile(await safe(input.path, true), input.content);
    return { message: 'Fichier enregistré.' };
  }
  if (input.tool === 'remove') {
    await fs.unlink(await safe(input.path));
    return { message: 'Fichier supprimé.' };
  }
  if (input.tool === 'exec') {
    if (typeof input.command !== 'string' || input.command.length > 4000)
      throw new Error('Commande refusée.');
    return command('/bin/sh', ['-c', input.command]);
  }
  if (input.tool === 'freeze') {
    const stage = '/tmp/artifact';
    await copySource(reference, stage);
    await git(['init', '-b', 'candidate'], stage);
    await git(['add', '--force', '.'], stage);
    await git(['commit', '-m', 'Reference'], stage);
    const baseCommit = await git(['rev-parse', 'HEAD'], stage);
    for (const name of await files(stage)) await fs.unlink(path.join(stage, name));
    await copySource(root, stage);
    await git(['add', '--force', '-A'], stage);
    const diff = await command(
      'git',
      [
        '-c',
        'core.hooksPath=/dev/null',
        'diff',
        '--cached',
        '--binary',
        '--no-ext-diff',
        '--no-textconv',
        baseCommit,
      ],
      stage,
      90000,
      120000,
    );
    // Never review or export a truncated patch.
    if (diff.exit_code !== 0 || diff.output_limit)
      throw new Error('Patch trop volumineux ; réduisez la modification.');
    const patch = diff.output;
    if (!patch) throw new Error('Aucune modification à proposer.');
    const exact = patch;
    if (exact.length > 100000) throw new Error('Patch limité à 100 000 caractères.');
    const changed = (await git(['diff', '--cached', '--name-only', baseCommit], stage)).split('\n');
    if (changed.length > 20) throw new Error('Patch limité à 20 fichiers.');
    await git(['commit', '-m', 'Proposition Jarvis'], stage);
    const commit = await git(['rev-parse', 'HEAD'], stage);
    await copySource(stage, '/artifact/repo');
    return {
      patch: exact,
      digest: createHash('sha256').update(exact).digest('hex'),
      commit,
      base_commit: baseCommit,
      files: changed,
    };
  }
  if (input.tool === 'validate') {
    const dir = '/tmp/check';
    await copySource('/artifact/repo', dir);
    await dependencies(dir);
    // Restore baseline test sources/config and fixed validation commands, outside the candidate's control.
    await fs.rm(dir + '/tests/unit', { recursive: true, force: true });
    await fs.cp(reference + '/tests/unit', dir + '/tests/unit', { recursive: true });
    await fs.copyFile(reference + '/tsconfig.json', dir + '/tsconfig.json');
    const type = await command(
      'node',
      [reference + '/node_modules/typescript/bin/tsc', '--noEmit'],
      dir,
      90000,
    );
    const testFiles = (await fs.readdir(dir + '/tests/unit'))
      .filter((f) => f.endsWith('.test.ts'))
      .map((f) => 'tests/unit/' + f);
    const tests = await command(
      'node',
      [reference + '/node_modules/tsx/dist/cli.mjs', '--test', ...testFiles],
      dir,
      90000,
    );
    return {
      passed: type.exit_code === 0 && tests.exit_code === 0,
      exit_code: type.exit_code || tests.exit_code,
      output: `TYPECHECK\n${type.output}\nBASELINE UNIT TESTS\n${tests.output}`.slice(-20000),
    };
  }
  throw new Error('Outil inconnu.');
}
try {
  console.log(JSON.stringify({ ok: true, result: await execute() }));
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: String(error.message).slice(0, 1000) }));
  process.exitCode = 1;
}
