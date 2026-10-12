import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { GitHubAuth } from '../../apps/github-bridge/auth.mjs';
test('GitHub browser login exposes only the device code and does not inherit host tokens', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-gh-auth-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const executable = path.join(
    process.env.JARVIS_TEST_EXECUTABLE_DIR ?? new URL('./fixtures/', import.meta.url).pathname,
    'github-auth.mjs',
  );
  const auth = new GitHubAuth(path.join(root, 'auth'), executable);
  t.after(() => auth.cancel());
  const old = process.env.GH_TOKEN;
  process.env.GH_TOKEN = 'host-secret-must-not-leak';
  try {
    assert.equal(auth.env().GH_TOKEN, undefined);
    assert.equal(auth.env().GITHUB_TOKEN, undefined);
  } finally {
    if (old === undefined) delete process.env.GH_TOKEN;
    else process.env.GH_TOKEN = old;
  }
  await auth.connect();
  let status;
  for (let i = 0; i < 50; i++) {
    status = await auth.status();
    if (status.login?.code) break;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.equal(status.login.code, 'ABCD-1234');
  assert.equal(status.login.verification_url, 'https://github.com/login/device');
  assert.equal(JSON.stringify(status).includes('host-secret'), false);
  const second = await auth.connect();
  assert.equal(second.login.id, status.login.id);
  await auth.disconnect();
  assert.equal((await auth.status()).state, 'disconnected');
});
