import { developmentRunner } from './development.mjs';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { timingSafeEqual, createHash, createHmac } from 'node:crypto';
const token = process.env.JARVIS_SUPERVISOR_TOKEN;
if (!token || token.length < 32) throw new Error('Supervisor token required');
const vaultKey = process.env.JARVIS_VAULT_KEY;
if (!vaultKey || !/^[a-f0-9]{64}$/.test(vaultKey)) throw new Error('Vault key required');
const prefix = process.env.JARVIS_RUNTIME_PREFIX ?? 'jarvis';
if (!/^[a-z][a-z0-9-]{0,30}$/.test(prefix)) throw new Error('Invalid runtime prefix');
const recipes = {
  codex: ['@openai/codex@0.161.0', '0.161.0'],
  'claude-code': ['@anthropic-ai/claude-code@2.1.296', '2.1.296'],
  opencode: ['opencode-ai@1.18.35', '1.18.35'],
};
const imageName = (h) => `${prefix}-harness-${h}:${recipes[h][1]}-v2`;
const building = new Map();
const creating = new Map();
function docker(args, input, timeout = 60000) {
  return new Promise((resolve, reject) => {
    const p = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    const timer = setTimeout(() => {
      p.kill('SIGKILL');
      reject(new Error('docker_timeout'));
    }, timeout);
    p.stdout.on('data', (chunk) => {
      out += chunk;
      if (out.length > 3000000) {
        p.kill('SIGKILL');
        reject(new Error('output_limit'));
      }
    });
    p.stderr.resume();
    p.on('error', () => {
      clearTimeout(timer);
      reject(new Error('docker_unavailable'));
    });
    p.on('close', (code) => {
      clearTimeout(timer);
      code === 0 ? resolve(out.trim()) : reject(new Error('docker_failed'));
    });
    p.stdin.end(input ?? '');
  });
}
async function installed(h) {
  const image = JSON.parse(await docker(['image', 'inspect', imageName(h)]))[0];
  return { state: 'installed', image_digest: image.Id, version: recipes[h][1] };
}
async function install(h) {
  try {
    return await installed(h);
  } catch {}
  if (!building.has(h))
    building.set(
      h,
      (async () => {
        await docker(
          [
            'build',
            '--label',
            'jarvis.managed=true',
            '--build-arg',
            `HARNESS_PACKAGE=${recipes[h][0]}`,
            '-t',
            imageName(h),
            '/opt/recipes',
          ],
          undefined,
          840000,
        );
        // Verify the package executable without accessing any host installation or account.
        await docker([
          'run',
          '--rm',
          '--network',
          'none',
          '--entrypoint',
          h === 'claude-code' ? 'claude' : h,
          imageName(h),
          '--version',
        ]);
        return installed(h);
      })().finally(() => building.delete(h)),
    );
  return building.get(h);
}
async function ensureAccount(h, id) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id))
    throw new Error('invalid_id');
  const name = `${prefix}-account-${id}`;
  if (creating.has(name)) return creating.get(name);
  const task = (async () => {
    const image = await installed(h);
    let info;
    try {
      info = JSON.parse(await docker(['inspect', name]))[0];
    } catch {}
    if (info) {
      if (info.Image !== image.image_digest) throw new Error('account_runtime_version_changed');
      if (
        info.Config.Labels?.['jarvis.harness'] !== h ||
        info.Config.Labels?.['jarvis.owner'] !== prefix
      )
        throw new Error('container_conflict');
      if (!info.State.Running) await docker(['start', name]);
    } else {
      await docker([
        'run',
        '-d',
        '--name',
        name,
        '--label',
        `jarvis.owner=${prefix}`,
        '--label',
        `jarvis.harness=${h}`,
        '--restart',
        'unless-stopped',
        '--init',
        '--read-only',
        '--cap-drop',
        'ALL',
        '--security-opt',
        'no-new-privileges:true',
        '--cpus',
        '1',
        '--memory',
        '1g',
        '--pids-limit',
        '128',
        '--tmpfs',
        '/tmp:rw,noexec,nosuid,size=256m',
        '--mount',
        `type=volume,source=${name}-data,target=/home/node`,
        '--env',
        `JARVIS_HARNESS=${h}`,
        '--env',
        `JARVIS_CREDENTIAL_KEY=${createHmac('sha256', vaultKey).update(id).digest('hex')}`,
        imageName(h),
      ]);
    }
    return name;
  })();
  creating.set(name, task);
  try {
    return await task;
  } finally {
    creating.delete(name);
  }
}
const development = developmentRunner(docker, prefix);
async function dispatch(input) {
  if (['development_status', 'development_operation', 'development_cancel'].includes(input.action))
    return development(input);
  const h = input.harness;
  if (!Object.hasOwn(recipes, h)) throw new Error('unknown_harness');
  if (input.action === 'install') return install(h);
  if (input.action === 'installation') {
    try {
      return await installed(h);
    } catch {
      return { state: 'absent' };
    }
  }
  if (
    input.action === 'start' &&
    input.image_digest &&
    (await installed(h)).image_digest !== input.image_digest
  )
    throw new Error('runtime_version_changed');
  const name = await ensureAccount(h, input.account_id);
  const allowed = ['status', 'connect', 'disconnect', 'models', 'start', 'run', 'cancel'];
  if (!allowed.includes(input.action)) throw new Error('unknown_action');
  // Native runtimes expose no network port: all access uses this fixed stdin bridge.
  const response = JSON.parse(
    await docker(['exec', '-i', name, 'node', '/runtime/request.mjs'], JSON.stringify(input)),
  );
  if (!response.ok) throw new Error(response.result?.error_code ?? 'runtime_unavailable');
  return response.result;
}
http
  .createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    const supplied = createHash('sha256')
      .update(req.headers.authorization ?? '')
      .digest();
    const expected = createHash('sha256').update(`Bearer ${token}`).digest();
    if (!timingSafeEqual(supplied, expected)) {
      res.statusCode = 401;
      return res.end('{}');
    }
    try {
      if (req.method !== 'POST' || req.url !== '/request') throw new Error('invalid_request');
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 150000) throw new Error('body_limit');
      }
      res.end(JSON.stringify(await dispatch(JSON.parse(body))));
    } catch (error) {
      res.statusCode = 503;
      const allowed = ['runtime_tls_error', 'runtime_network_error', 'runtime_provider_refused'];
      res.end(
        JSON.stringify({
          error_code: allowed.includes(error?.message) ? error.message : 'runtime_unavailable',
        }),
      );
    }
  })
  .listen(7080, '0.0.0.0');
