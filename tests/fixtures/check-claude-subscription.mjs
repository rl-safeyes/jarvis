import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, copyFileSync, chmodSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
const name = 'jarvis-claude-protocol-' + randomUUID().slice(0, 8);
const home = mkdtempSync(join(tmpdir(), 'jarvis-claude-protocol-'));
const bin = join(home, 'bin');
mkdirSync(bin);
copyFileSync(resolve('tests/fixtures/claude.mjs'), join(bin, 'claude'));
chmodSync(join(bin, 'claude'), 0o755);
const docker = (args, input) =>
  execFileSync('docker', args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const request = (input) => {
  const value = JSON.parse(
    docker(['exec', '-i', name, 'node', '/runtime/request.mjs'], JSON.stringify(input)),
  );
  if (!value.ok) throw new Error(value.result.error_code);
  return value.result;
};
async function ready() {
  for (let i = 0; i < 40; i++) {
    try {
      return request({ action: 'status' });
    } catch {
      await wait(100);
    }
  }
  throw new Error('Fixture runtime failed to start');
}
async function run(prompt) {
  const id = randomUUID();
  request({ action: 'start', id, prompt, model: 'sonnet', instructions: 'Fixture only' });
  for (let i = 0; i < 40; i++) {
    const r = request({ action: 'run', id });
    if (r.state !== 'running') return r;
    await wait(100);
  }
  throw new Error('Fixture run timeout');
}
try {
  docker([
    'run',
    '--rm',
    '-d',
    '--name',
    name,
    '--network',
    'none',
    '--init',
    '--read-only',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges:true',
    '--tmpfs',
    '/tmp:rw,noexec,nosuid,size=64m',
    '--mount',
    `type=bind,source=${home},target=/home/node`,
    '--mount',
    `type=bind,source=${resolve('infra/harness')},target=/runtime,readonly`,
    '--mount',
    `type=bind,source=${bin},target=/fixture-bin,readonly`,
    '-e',
    'PATH=/fixture-bin:/usr/local/bin:/usr/bin:/bin',
    '-e',
    'JARVIS_HARNESS=claude-code',
    '-e',
    `JARVIS_CREDENTIAL_KEY=${'1'.repeat(64)}`,
    process.env.CLAUDE_FIXTURE_IMAGE ?? 'jarvis-harness-claude-code:2.1.296-v3',
  ]);
  assert.equal((await ready()).state, 'disconnected');
  const { login } = request({ action: 'connect', method: 'claude_subscription' });
  assert.throws(
    () =>
      request({
        action: 'complete_login',
        loginId: randomUUID(),
        code: 'fixture-code#fixture-state',
      }),
    /auth_session_expired/,
  );
  assert.equal(
    request({
      action: 'complete_login',
      loginId: login.loginId,
      code: 'fixture-code#fixture-state',
    }).auth_method,
    'claude_subscription',
  );
  assert.equal((await run('hello')).text, 'fixture claude_subscription');
  assert.equal((await run('quota-exhausted')).state, 'failed');
  assert.equal(
    docker(['exec', name, 'cat', '/home/node/fixture-last-mode']),
    'claude_subscription',
  );
  docker(['restart', name]);
  assert.equal((await ready()).auth_method, 'claude_subscription');
  request({ action: 'connect', method: 'api_key', secret: 'fixture-api-only' });
  assert.equal(request({ action: 'status' }).auth_method, 'api_key');
  assert.equal((await run('hello')).text, 'fixture api_key');
  const again = request({ action: 'connect', method: 'claude_subscription' });
  request({ action: 'disconnect' });
  assert.equal(request({ action: 'status' }).state, 'disconnected');
  assert.throws(
    () =>
      request({
        action: 'complete_login',
        loginId: again.login.loginId,
        code: 'fixture-code#fixture-state',
      }),
    /auth_session_expired/,
  );
  console.log(
    'PASS: runtime login, native subscription execution without API key, quota failure without fallback, restart, API mode switch and logout.',
  );
} finally {
  try {
    docker(['stop', '--time', '1', name]);
  } catch {}
  rmSync(home, { recursive: true, force: true });
}
