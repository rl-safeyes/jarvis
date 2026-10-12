import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool, Repository, migrate, transaction } from '@jarvis/storage';
import { HarnessRepository } from '../../packages/storage/src/harnesses.ts';
import { createApp } from '../../apps/api/src/app.ts';
if (!process.env.TEST_DATABASE_URL) throw new Error('Dedicated test database required');
const schema = `harness_test_${randomUUID().replaceAll('-', '')}`;
const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const pool = new Pool({
  connectionString: process.env.TEST_DATABASE_URL,
  options: `-c search_path=${schema}`,
});
const repo = new HarnessRepository(pool);
const live = new Repository(pool, 'live');
before(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
  await migrate(pool);
  await migrate(pool);
  await repo.seed();
});
after(async () => {
  await pool.end();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
});
async function ready(harness: 'codex' | 'claude-code' = 'codex') {
  await pool.query(
    "UPDATE harness_installations SET state='installed',image_digest='sha256:test-only' WHERE id=$1",
    [harness],
  );
  const account = await repo.createAccount({ id: randomUUID(), name: 'Test account', harness });
  await pool.query("UPDATE harness_accounts SET state='ready' WHERE id=$1", [account.id]);
  const profile = await repo.createProfile({
    id: randomUUID(),
    name: 'Test profile',
    account_id: account.id,
    model: 'test-model',
  });
  await pool.query("UPDATE execution_profiles SET state='ready',tested_revision=0 WHERE id=$1", [
    profile.id,
  ]);
  return { account, profile };
}
async function defaultTo(id: string | null) {
  const d = await repo.dashboard();
  await repo.setDefault(id, d.settings.revision);
}
test('configuration is accessible without a model, while ordinary live chat requires setup', async () => {
  const c = await live.createConversation(randomUUID(), 'Setup');
  await assert.rejects(
    live.submit(c.id, {
      client_message_id: randomUUID(),
      text: 'Bonjour',
      expected_conversation_version: 0,
    }),
    { code: 'setup_required' },
  );
  const app = await createApp({
    repo: live,
    password: 'integration-password-only-123',
    origin: 'http://localhost:5173',
    mode: 'live',
  });
  assert.equal((await app.inject({ url: '/api/v1/harnesses' })).statusCode, 401);
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { origin: 'http://localhost:5173' },
    payload: { password: 'integration-password-only-123' },
  });
  const cookie = login.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  const dashboard = await app.inject({ url: '/api/v1/harnesses', headers: { cookie } });
  assert.equal(dashboard.statusCode, 200);
  assert.equal(dashboard.json().harnesses.length, 3);
  const csrf = await app.inject({
    method: 'POST',
    url: '/api/v1/harness-installations',
    headers: { cookie, origin: 'http://localhost:5173' },
    payload: { id: randomUUID(), harness: 'codex' },
  });
  assert.equal(csrf.statusCode, 403);
  await app.close();
});
test('live submission freezes the default and records the durable operation atomically', async () => {
  const a = await ready();
  await defaultTo(a.profile.id);
  const c = await live.createConversation(randomUUID(), 'Live');
  const input = {
    client_message_id: randomUUID(),
    text: 'Bonjour',
    expected_conversation_version: 0,
  };
  const responses = await Promise.all([live.submit(c.id, input), live.submit(c.id, input)]);
  assert.equal(responses[0]!.id, responses[1]!.id);
  assert.equal(responses[0]!.runtime!.profile_id, a.profile.id);
  assert.equal(
    (await pool.query('SELECT * FROM harness_operations WHERE id=$1', [responses[0]!.id])).rowCount,
    1,
  );
  const b = await ready('claude-code');
  await defaultTo(b.profile.id);
  assert.equal((await live.getMission(responses[0]!.id)).runtime!.profile_id, a.profile.id);
  const inherited = await transaction(pool, (c) => repo.resolve(c, 'engineering.developer'));
  assert.equal(inherited.profile_id, b.profile.id);
  // The simulation queue can never claim a live mission.
  assert.equal(await new Repository(pool).claimNext(), null);
});
test('Jarvis can override its profile without changing inheritance of other agents', async () => {
  const a = await ready();
  const b = await ready('claude-code');
  await defaultTo(a.profile.id);
  await repo.setAgent('direction.jarvis', 'Instructions de test', b.profile.id, 0);
  const own = await transaction(pool, (c) => repo.resolve(c));
  const child = await transaction(pool, (c) => repo.resolve(c, 'quality.reviewer'));
  assert.equal(own.profile_id, b.profile.id);
  assert.equal(own.source, 'agent');
  assert.equal(child.profile_id, a.profile.id);
  await assert.rejects(repo.setAgent('direction.jarvis', 'stale', null, 0), {
    code: 'version_conflict',
  });
  await pool.query("UPDATE harness_accounts SET state='disabled',revision=revision+1 WHERE id=$1", [
    b.account.id,
  ]);
  await assert.rejects(
    transaction(pool, (c) => repo.resolve(c)),
    { code: 'profile_not_ready' },
  );
  await repo.setAgent('direction.jarvis', 'Instructions de test', null, 1);
});
test('untested profiles and competing default updates are rejected', async () => {
  const a = await ready();
  const p = await repo.createProfile({
    id: randomUUID(),
    name: 'Untested',
    account_id: a.account.id,
    model: 'other-model',
  });
  const { settings } = await repo.dashboard();
  await assert.rejects(repo.setDefault(p.id, settings.revision), { code: 'profile_not_ready' });
  const updates = await Promise.allSettled([
    repo.setDefault(a.profile.id, settings.revision),
    repo.setDefault(null, settings.revision),
  ]);
  assert.equal(updates.filter((x) => x.status === 'fulfilled').length, 1);
});
test('installation requested through chat survives duplicate submissions without a configured default', async () => {
  await defaultTo(null);
  const c = await live.createConversation(randomUUID(), 'Configuration');
  const input = {
    client_message_id: randomUUID(),
    text: 'Jarvis, installe OpenCode',
    expected_conversation_version: 0,
  };
  const a = await live.submit(c.id, input);
  const b = await live.submit(c.id, input);
  assert.equal(a.id, b.id);
  assert.equal(a.harness, 'control');
  assert.match(a.result!, /Installation de opencode demandée/);
  const op = (await pool.query('SELECT * FROM harness_operations WHERE id=$1', [a.id])).rows[0];
  assert.equal(op.kind, 'install');
  assert.equal((await live.detail(c.id)).messages.length, 2);
});
test('test operation is bound to the account revision; idempotency keys cannot change profile', async () => {
  const a = await ready();
  const opId = randomUUID();
  const op = await repo.test(opId, a.profile.id);
  await pool.query('UPDATE harness_accounts SET revision=revision+1 WHERE id=$1', [a.account.id]);
  const repeated = await repo.test(opId, a.profile.id);
  assert.equal(repeated.payload.account_revision, op.payload.account_revision);
  assert.equal(
    (await repo.dashboard()).profiles.find((p) => p.id === a.profile.id)!.state,
    'untested',
  );
  const b = await ready();
  await assert.rejects(repo.test(opId, b.profile.id), { code: 'idempotency_conflict' });
});

test('Claude subscription login is authenticated, CSRF protected and invalidates the old tested profile', async (t) => {
  const { createServer } = await import('node:http');
  const calls: Record<string, unknown>[] = [];
  const loginId = randomUUID();
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    calls.push(body);
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify(
        body.action === 'connect'
          ? {
              state: 'connecting',
              login: {
                kind: 'claude_subscription',
                loginId,
                verificationUrl: 'https://claude.com/cai/oauth/authorize?state=fixture',
                expires_at: new Date(Date.now() + 60000).toISOString(),
              },
            }
          : { state: 'ready', auth_method: 'claude_subscription', login: null },
      ),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const app = await createApp({
    repo: live,
    password: 'integration-password-only-123',
    origin: 'http://localhost:5173',
    mode: 'live',
    supervisorUrl: `http://127.0.0.1:${address.port}`,
    supervisorToken: 'fixture',
  });
  t.after(() => app.close());
  const { account, profile } = await ready('claude-code');
  const url = `/api/v1/accounts/${account.id}/connect`;
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url,
        headers: { origin: 'http://localhost:5173' },
        payload: { method: 'claude_subscription' },
      })
    ).statusCode,
    401,
  );
  const session = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { origin: 'http://localhost:5173' },
    payload: { password: 'integration-password-only-123' },
  });
  const headers = {
    origin: 'http://localhost:5173',
    cookie: session.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
    'x-csrf-token': session.json().csrf_token,
  };
  const complete = { loginId, code: 'fixture-code#fixture-state' };
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: url + '/complete',
        headers: { cookie: headers.cookie, origin: headers.origin },
        payload: complete,
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (await app.inject({ method: 'POST', url: url + '/complete', headers, payload: complete }))
      .statusCode,
    409,
  );
  const login = await app.inject({
    method: 'POST',
    url,
    headers,
    payload: { method: 'claude_subscription' },
  });
  assert.equal(login.statusCode, 200);
  assert.equal(login.json().login.loginId, loginId);
  assert.equal((await repo.account(account.id)).state, 'connecting');
  assert.equal(
    (await repo.dashboard()).profiles.find((p) => p.id === profile.id)!.state,
    'untested',
  );
  const beforeInvalid = calls.length;
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: url + '/complete',
        headers,
        payload: { loginId, code: 'bad\ncommand' },
      })
    ).statusCode,
    400,
  );
  assert.equal(calls.length, beforeInvalid);
  const connected = await app.inject({
    method: 'POST',
    url: url + '/complete',
    headers,
    payload: complete,
  });
  assert.equal(connected.statusCode, 200);
  assert.equal(connected.json().auth_method, 'claude_subscription');
  assert.equal((await repo.account(account.id)).state, 'ready');
  assert.equal(
    (await repo.dashboard()).profiles.find((p) => p.id === profile.id)!.state,
    'untested',
  );
  assert.equal(calls.at(-1)!.action, 'complete_login');
  const codex = await ready('codex');
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: `/api/v1/accounts/${codex.account.id}/connect`,
        headers,
        payload: { method: 'claude_subscription' },
      })
    ).statusCode,
    400,
  );
});
