// Executed by the trusted runner in its own container, against synthetic data only.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const base = process.env.PROBE_ORIGIN;
assert.ok(base && new URL(base).hostname.endsWith('-app'));
const request = async (path, body, headers = {}) =>
  fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      origin: 'http://localhost:3000',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(5000),
  });
for (let i = 0; ; i++) {
  try {
    if ((await request('/healthz')).ok) break;
  } catch {}
  assert.ok(i < 60, 'Preproduction did not become healthy');
  await new Promise((r) => setTimeout(r, 1000));
}
assert.equal((await request('/api/v1/conversations')).status, 401);
const page = await request('/');
assert.ok(page.ok);
assert.match(await page.text(), /<div id="root">/);
const login = await request('/api/v1/auth/login', { password: process.env.PROBE_PASSWORD });
assert.equal(login.status, 200);
const session = await login.json();
assert.equal(session.mode, 'mock');
const headers = {
  cookie: login.headers.get('set-cookie').split(';')[0],
  'x-csrf-token': session.csrf_token,
};
assert.equal(
  (
    await request(
      '/api/v1/conversations',
      { client_conversation_id: randomUUID(), title: 'Forbidden' },
      { cookie: headers.cookie },
    )
  ).status,
  403,
);
const conversation = await request(
  '/api/v1/conversations',
  { client_conversation_id: randomUUID(), title: 'Synthetic release probe' },
  headers,
);
assert.equal(conversation.status, 201);
const c = await conversation.json();
const body = {
  client_message_id: randomUUID(),
  text: 'Réponds à ce contrôle synthétique.',
  expected_conversation_version: c.version,
};
const submit = await request(`/api/v1/conversations/${c.id}/messages`, body, headers);
assert.equal(submit.status, 202);
const mission = await submit.json();
const duplicate = await request(`/api/v1/conversations/${c.id}/messages`, body, headers);
assert.equal((await duplicate.json()).id, mission.id);
for (let i = 0; ; i++) {
  const r = await request(`/api/v1/missions/${mission.id}`, undefined, headers);
  assert.ok(r.ok);
  const m = await r.json();
  if (m.status === 'succeeded') {
    assert.ok(m.result);
    break;
  }
  assert.ok(
    !['failed', 'cancelled'].includes(m.status) && i < 60,
    'Synthetic mission did not succeed',
  );
  await new Promise((r) => setTimeout(r, 500));
}
assert.equal((await request('/api/v1/auth/logout', {}, headers)).status, 204);
assert.equal((await request('/api/v1/conversations', undefined, headers)).status, 401);
console.log(
  'PASS: web, database migrations, owner session, CSRF, persistent conversation, idempotency, simulated mission and logout.',
);
