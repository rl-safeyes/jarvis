import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ClaudeAuth,
  subscriptionUrl,
  claudeEnvironment,
} from '../../infra/harness/claude-auth.mjs';

async function fixture(t, { lifetime = 10000, mode = 'success' } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'jarvis-claude-auth-'));
  const command = join(
    process.env.JARVIS_TEST_EXECUTABLE_DIR ?? new URL('./fixtures/', import.meta.url).pathname,
    'claude-auth.mjs',
  );
  const credentialFile = join(dir, 'credential.json');
  const options = {
    command,
    cwd: dir,
    lifetime,
    commandTimeout: 2000,
    env: {
      PATH: process.env.PATH,
      FIXTURE_STATE: join(dir, 'native.json'),
      FIXTURE_MODE: mode,
      ANTHROPIC_API_KEY: 'must-never-be-inherited',
      ANTHROPIC_AUTH_TOKEN: 'must-never-be-inherited',
      CLAUDE_CODE_OAUTH_TOKEN: 'must-never-be-inherited',
    },
    readCredentials: async () => {
      try {
        return JSON.parse(await readFile(credentialFile, 'utf8'));
      } catch {
        return null;
      }
    },
    saveCredentials: (value) => writeFile(credentialFile, JSON.stringify(value)),
    clearCredentials: () => rm(credentialFile, { force: true }),
  };
  const auth = new ClaudeAuth(options);
  t.after(async () => {
    auth.stop();
    await rm(dir, { recursive: true, force: true });
  });
  return { auth, options };
}

test('only official Claude subscription authorization URLs are exposed', () => {
  const suffix = '/cai/oauth/authorize?state=x&code_challenge=y';
  assert.ok(subscriptionUrl('https://claude.com' + suffix));
  for (const raw of [
    'http://claude.com' + suffix,
    'https://claude.com.evil.invalid' + suffix,
    'https://evil@claude.com' + suffix,
    'https://platform.claude.com' + suffix,
    'https://claude.com/settings?state=x&code_challenge=y',
    'https://claude.com' + suffix.replace('state=x&', ''),
  ])
    assert.equal(subscriptionUrl(raw), null);
});

test('subscription login replaces the API key, validates the native account and survives a runtime restart', async (t) => {
  const { auth, options } = await fixture(t);
  await options.saveCredentials({ secret: 'former-api-secret' });
  const result = await auth.begin();
  assert.equal(result.state, 'connecting');
  assert.equal(result.login.kind, 'claude_subscription');
  assert.equal(await options.readCredentials(), null);
  assert.equal((await auth.begin()).login.loginId, result.login.loginId);
  await assert.rejects(
    auth.complete('wrong-session', 'fixture-code#fixture-state'),
    /auth_session_expired/,
  );
  await assert.rejects(
    auth.complete(result.login.loginId, 'code\nsecond-command'),
    /invalid_auth_code/,
  );
  const connected = await auth.complete(result.login.loginId, 'fixture-code#fixture-state');
  assert.equal(connected.state, 'ready');
  assert.equal(connected.auth_method, 'claude_subscription');
  assert.doesNotMatch(JSON.stringify(connected), /private@|fixture-code|secret/);
  assert.deepEqual(await options.readCredentials(), { method: 'claude_subscription' });
  const restarted = new ClaudeAuth(options);
  assert.equal((await restarted.status()).auth_method, 'claude_subscription');
  await restarted.disconnect();
  assert.equal((await restarted.status()).state, 'disconnected');
});

test('invalid browser code fails closed without restoring API billing or leaking provider output', async (t) => {
  const { auth, options } = await fixture(t);
  const { login } = await auth.begin();
  const result = await auth.complete(login.loginId, 'bad-private-code');
  assert.equal(result.state, 'disconnected');
  assert.equal(result.error_code, 'auth_failed');
  assert.equal(await options.readCredentials(), null);
  assert.doesNotMatch(JSON.stringify(result), /bad-private-code/);
});

test('a Console/API native login is never accepted as a subscription', async (t) => {
  const { auth, options } = await fixture(t, { mode: 'api' });
  const { login } = await auth.begin();
  assert.equal(
    (await auth.complete(login.loginId, 'fixture-code#fixture-state')).state,
    'disconnected',
  );
  assert.equal(await options.readCredentials(), null);
});

test('expired and cancelled login sessions reject late browser codes', async (t) => {
  const { auth } = await fixture(t, { lifetime: 120 });
  const { login } = await auth.begin();
  await new Promise((resolve) => setTimeout(resolve, 160));
  assert.equal((await auth.status()).error_code, 'auth_expired');
  await assert.rejects(
    auth.complete(login.loginId, 'fixture-code#fixture-state'),
    /auth_session_expired/,
  );
  const renewed = await auth.begin();
  await auth.disconnect();
  await assert.rejects(
    auth.complete(renewed.login.loginId, 'fixture-code#fixture-state'),
    /auth_session_expired/,
  );
  assert.equal((await auth.status()).state, 'disconnected');
});

test('the subscription environment carries no API or host OAuth credentials', () => {
  const env = claudeEnvironment();
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, undefined);
  assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, undefined);
  assert.equal(env.CLAUDE_CONFIG_DIR, '/home/node/.claude');
});
