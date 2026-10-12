import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { developmentRunner } from '../../apps/runner-supervisor/development.mjs';
const exec = promisify(execFile),
  prefix = 'jarvis-development-fixture';
const docker = async (args) => (await exec('docker', args, { maxBuffer: 3000000 })).stdout.trim();
let runner = developmentRunner(docker, prefix);
const image = await runner({ action: 'development_status' });
assert.equal(image.available, true);
const workspace_id = randomUUID();
const request = (operation) => ({
  action: 'development_operation',
  id: randomUUID(),
  workspace_id,
  image_digest: image.image_digest,
  operation,
});
async function result(input) {
  const end = Date.now() + 250000;
  while (Date.now() < end) {
    const r = await runner(input);
    if (['succeeded', 'failed', 'cancelled'].includes(r.state)) return r;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('Tool timed out');
}
assert.equal((await result(request({ tool: 'initialize' }))).state, 'succeeded');
const shell = request({
  tool: 'exec',
  command:
    'test ! -e /var/run/docker.sock && test ! -e /home/node/.codex/auth.json && test -z "$GH_TOKEN" && git --version && gh --version && node --version && printf once >> receipt.txt',
});
assert.equal((await result(shell)).result.exit_code, 0);
const config = JSON.parse(await docker(['inspect', `${prefix}-dev-${shell.id}`]))[0];
assert.equal(config.HostConfig.NetworkMode, 'none');
assert.equal(config.HostConfig.ReadonlyRootfs, true);
assert.equal(config.Config.User, '1000:1000');
assert.deepEqual(config.HostConfig.CapDrop, ['ALL']);
assert.ok(
  config.Mounts.every(
    (m) => m.Type === 'volume' && m.Name === `${prefix}-workspace-${workspace_id}`,
  ),
);
runner = developmentRunner(docker, prefix);
assert.equal((await result(shell)).state, 'succeeded');
assert.equal((await result(request({ tool: 'read', path: 'receipt.txt' }))).result.content, 'once');
await assert.rejects(
  runner({ ...shell, operation: { tool: 'exec', command: 'echo changed' } }),
  /operation_conflict/,
);
await result(request({ tool: 'exec', command: 'ln -s /etc/passwd escape' }));
assert.equal((await result(request({ tool: 'read', path: 'escape' }))).state, 'failed');
assert.equal(
  (await result(request({ tool: 'write', path: 'escape', content: 'no' }))).state,
  'failed',
);
assert.equal((await result(request({ tool: 'read', path: '../etc/passwd' }))).state, 'failed');
await result(request({ tool: 'exec', command: 'rm escape' }));
await result(
  request({
    tool: 'exec',
    command: "printf '\nhidden-artifact.txt\n' >> .gitignore; printf hidden > hidden-artifact.txt",
  }),
);
const freeze = await result(request({ tool: 'freeze' }));
assert.equal(freeze.state, 'succeeded', JSON.stringify(freeze));
assert.match(freeze.result.patch, /\+once/);
assert.match(freeze.result.patch, /hidden-artifact.txt/);
assert.match(freeze.result.patch, /\+hidden/);
await result(request({ tool: 'write', path: 'receipt.txt', content: 'modified after freeze' }));
const validate = await result(request({ tool: 'validate' }));
assert.equal(validate.state, 'succeeded', JSON.stringify(validate));
assert.equal(validate.result.passed, true, validate.result.output);
const slow = request({ tool: 'exec', command: 'sleep 60; echo forbidden > after-cancel.txt' });
assert.equal((await runner(slow)).state, 'running');
assert.equal(
  (await runner({ action: 'development_cancel', id: slow.id, workspace_id })).state,
  'cancelled',
);
assert.equal((await runner(slow)).state, 'cancelled');
const neverStarted = request({ tool: 'exec', command: 'echo forbidden' });
await runner({ action: 'development_cancel', id: neverStarted.id, workspace_id });
assert.equal((await runner(neverStarted)).state, 'cancelled');
await result(
  request({
    tool: 'exec',
    command: 'mv /workspace/repo /workspace/retired && ln -s /opt/reference /workspace/repo',
  }),
);
assert.equal((await result(request({ tool: 'read', path: 'README.md' }))).state, 'failed');
console.log(
  'PASS: real Docker tools, no account/host mounts/network, persistent operation idempotency, path/symlink checks, immutable patch, independent validation and durable cancellation.',
);
