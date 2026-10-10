import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { Pool, Repository, migrate } from '@jarvis/storage';
import { MockHarness } from '@jarvis/harness-mock';
import { createApp } from '../../apps/api/src/app.ts';
import { SimulationWorker } from '../../apps/api/src/worker.ts';

if (!process.env.TEST_DATABASE_URL)
  throw new Error('TEST_DATABASE_URL doit pointer vers une base de test dédiée.');
const schema = `jarvis_test_${randomUUID().replaceAll('-', '')}`;
const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const pool = new Pool({
  connectionString: process.env.TEST_DATABASE_URL,
  options: `-c search_path=${schema}`,
});
const repo = new Repository(pool);
before(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
  await migrate(pool);
  await migrate(pool);
});
after(async () => {
  await pool.end();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
});
async function queued(text = 'Une demande de test') {
  const convo = await repo.createConversation(randomUUID(), 'Test');
  const input = { client_message_id: randomUUID(), text, expected_conversation_version: 0 };
  return { convo, input, mission: await repo.submit(convo.id, input) };
}

test('concurrent duplicate submissions create exactly one mission and message', async () => {
  const convo = await repo.createConversation(randomUUID(), 'Test');
  const input = {
    client_message_id: randomUUID(),
    text: 'Bonjour',
    expected_conversation_version: 0,
  };
  const result = await Promise.all(Array.from({ length: 8 }, () => repo.submit(convo.id, input)));
  assert.equal(new Set(result.map((value) => value.id)).size, 1);
  const detail = await repo.detail(convo.id);
  assert.equal(detail.messages.length, 1);
  assert.equal(detail.missions.length, 1);
  assert.equal(detail.conversation.version, 1);
  await assert.rejects(repo.submit(convo.id, { ...input, text: 'Autre contenu' }), {
    code: 'idempotency_conflict',
  });
  await repo.cancel(result[0]!.id);
});
test('conversation creation retries preserve identity, while stale writes are rejected', async () => {
  const id = randomUUID();
  const a = await repo.createConversation(id, 'Titre');
  const b = await repo.createConversation(id, 'Titre');
  assert.equal(a.id, b.id);
  await assert.rejects(repo.createConversation(id, 'Différent'), { code: 'idempotency_conflict' });
  await assert.rejects(
    repo.submit(a.id, {
      client_message_id: randomUUID(),
      text: 'Bonjour',
      expected_conversation_version: 10,
    }),
    { code: 'version_conflict' },
  );
});
test('expired leases can be reclaimed, and old workers cannot commit results', async () => {
  const task = await queued();
  const first = await repo.claimNext();
  assert.equal(first?.mission.id, task.mission.id);
  await pool.query("UPDATE missions SET lease_until=now()-interval '1 second' WHERE id=$1", [
    task.mission.id,
  ]);
  const second = await repo.claimNext();
  assert.equal(second?.mission.id, task.mission.id);
  assert.notEqual(second!.leaseToken, first!.leaseToken);
  assert.equal(await repo.finish(first!, 'Old result'), false);
  assert.equal(await repo.finish(second!, 'New result'), true);
  assert.equal(await repo.finish(second!, 'Duplicate result'), false);
  const detail = await repo.detail(task.convo.id);
  assert.equal(detail.messages.filter((item) => item.role === 'assistant').length, 1);
  assert.equal(detail.missions[0]!.attempt, 2);
  const events = await repo.events(task.mission.id);
  assert.deepEqual(
    events.map((event) => event.sequence),
    [1, 2, 3, 4],
  );
  assert.deepEqual(
    (await repo.events(task.mission.id, 2)).map((event) => event.sequence),
    [3, 4],
  );
});
test('cancellation wins against a worker completing later and is idempotent', async () => {
  const task = await queued();
  const claim = await repo.claimNext();
  await repo.cancel(task.mission.id);
  await repo.cancel(task.mission.id);
  assert.equal(await repo.finish(claim!, 'Too late'), false);
  assert.equal(await repo.renew(claim!), false);
  assert.equal((await repo.getMission(task.mission.id)).status, 'cancelled');
  assert.equal(
    (await repo.events(task.mission.id)).filter((event) => event.type === 'mission.cancelled')
      .length,
    1,
  );
});
test('retry count is bounded after repeated worker interruptions', async () => {
  const task = await queued();
  for (let i = 0; i < 3; i++) {
    const claim = await repo.claimNext();
    assert.ok(claim);
    await repo.release(claim);
  }
  assert.equal(await repo.claimNext(), null);
  assert.equal((await repo.getMission(task.mission.id)).status, 'failed');
});
test('simulation worker processes persisted jobs and leaves an assistant response', async () => {
  const task = await queued('Test du worker');
  const worker = new SimulationWorker(repo, new MockHarness(1), (error) => {
    throw error;
  });
  worker.start();
  try {
    for (let i = 0; i < 100; i++) {
      if ((await repo.getMission(task.mission.id)).status === 'succeeded') break;
      await sleep(20);
    }
    assert.equal((await repo.getMission(task.mission.id)).status, 'succeeded');
    assert.match((await repo.detail(task.convo.id)).messages[1]!.content, /simulation/);
  } finally {
    await worker.stop();
  }
});
test('authentication, CSRF, expiry, validation and logout protect the API', async () => {
  const password = 'only-for-integration-tests';
  const origin = 'http://localhost:5173';
  const app = await createApp({ repo, password, origin });
  try {
    assert.equal((await app.inject('/api/v1/conversations')).statusCode, 401);
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          payload: { password },
          headers: { origin: 'https://evil.example' },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          payload: { password: 'wrong' },
          headers: { origin },
        })
      ).statusCode,
      401,
    );
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { password },
      headers: { origin },
    });
    assert.equal(login.statusCode, 200);
    const cookie = login.headers['set-cookie']!.toString().split(';')[0]!;
    assert.match(login.headers['set-cookie']!.toString(), /HttpOnly/);
    assert.match(login.headers['set-cookie']!.toString(), /SameSite=Strict/i);
    const headers = { cookie, origin, 'x-csrf-token': login.json().csrf_token };
    const payload = { client_conversation_id: randomUUID() };
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/conversations',
          payload,
          headers: { cookie, origin },
        })
      ).statusCode,
      403,
    );
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/conversations',
      payload,
      headers,
    });
    assert.equal(created.statusCode, 201);
    const url = `/api/v1/conversations/${created.json().id}/messages`;
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url,
          payload: { text: '', client_message_id: randomUUID(), expected_conversation_version: 0 },
          headers,
        })
      ).statusCode,
      400,
    );
    const message = {
      text: 'API test',
      client_message_id: randomUUID(),
      expected_conversation_version: 0,
    };
    const first = await app.inject({ method: 'POST', url, payload: message, headers });
    const retry = await app.inject({ method: 'POST', url, payload: message, headers });
    assert.equal(first.statusCode, 202);
    assert.equal(first.json().id, retry.json().id);
    await repo.cancel(first.json().id);
    assert.equal(
      (await app.inject({ method: 'POST', url: '/api/v1/auth/logout', payload: {}, headers }))
        .statusCode,
      204,
    );
    assert.equal((await app.inject({ url: '/api/v1/conversations', headers })).statusCode, 401);
    const { createHash } = await import('node:crypto');
    const expiredToken = 'expired-session-test-only';
    await repo.createSession(
      createHash('sha256').update(expiredToken).digest('hex'),
      'expired-csrf',
      new Date(Date.now() - 1000),
    );
    assert.equal(
      (
        await app.inject({
          url: '/api/v1/auth/session',
          headers: { cookie: `jarvis_session=${expiredToken}` },
        })
      ).statusCode,
      401,
    );
  } finally {
    await app.close();
  }
});
test('SSE replays only events after the cursor and closes at the terminal state', async () => {
  const task = await queued();
  await repo.cancel(task.mission.id);
  const app = await createApp({
    repo,
    password: 'only-for-integration-tests',
    origin: 'http://localhost:5173',
  });
  const token = 'a-local-event-test-token';
  const { createHash } = await import('node:crypto');
  await repo.createSession(
    createHash('sha256').update(token).digest('hex'),
    'test-csrf',
    new Date(Date.now() + 60_000),
  );
  try {
    const response = await app.inject({
      url: `/api/v1/missions/${task.mission.id}/events`,
      headers: { cookie: `jarvis_session=${token}`, 'last-event-id': '1' },
    });
    assert.equal(response.statusCode, 200);
    assert.match(response.body, /mission.cancelled/);
    assert.doesNotMatch(response.body, /mission.queued/);
    assert.match(response.body, /event: done/);
  } finally {
    await app.close();
  }
});
