import { parseEnv } from 'node:util';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const cfg = parseEnv(readFileSync('.env', 'utf8'));
const base = 'http://localhost:3304';
const response = await fetch(base + '/api/v1/auth/login', {
  method: 'POST',
  headers: { Origin: base, 'Content-Type': 'application/json' },
  body: JSON.stringify({ password: cfg.JARVIS_OWNER_PASSWORD }),
});
const session = await response.json();
const headers = {
  Origin: base,
  'Content-Type': 'application/json',
  Cookie: response.headers.get('set-cookie').split(';')[0],
  'X-CSRF-Token': session.csrf_token,
};
async function api(path, body) {
  const r = await fetch(base + '/api/v1' + path, {
    headers,
    method: body ? 'POST' : 'GET',
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = r.status === 204 ? null : await r.json();
  if (!r.ok) throw new Error(`${path}: ${r.status} ${JSON.stringify(data)}`);
  return data;
}
async function until(work, check, timeout = 60000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const r = await work();
    if (check(r)) return r;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('Timed out');
}
const installed = await api('/harness-installations', { id: randomUUID(), harness: 'codex' });
await until(
  () => api('/harnesses'),
  (d) => d.operations.some((o) => o.id === installed.id && o.state === 'succeeded'),
);
const account = await api('/accounts', {
  id: randomUUID(),
  name: 'Protocol fixture only',
  harness: 'codex',
});
await until(
  async () => {
    try {
      return await api(`/accounts/${account.id}/status`);
    } catch {
      return null;
    }
  },
  (x) => x?.state === 'disconnected',
);
await api(`/accounts/${account.id}/connect`, {
  method: 'api_key',
  secret: 'fixture-not-a-provider-secret',
});
const profile = await api('/execution-profiles', {
  id: randomUUID(),
  name: 'Protocol fixture profile',
  account_id: account.id,
  model: 'fixture-model',
});
await api(`/execution-profiles/${profile.id}/test`, { id: randomUUID() });
await until(
  () => api('/harnesses'),
  (d) => d.profiles.some((p) => p.id === profile.id && p.state === 'ready'),
);
let d = await api('/harnesses');
await api('/runtime-settings', { profile_id: profile.id, expected_revision: d.settings.revision });
console.log('Profile tested and selected using the real Temporal worker.');
async function start(text) {
  const c = await api('/conversations', { client_conversation_id: randomUUID() });
  const input = {
    client_message_id: randomUUID(),
    text,
    expected_conversation_version: 0,
    development: true,
  };
  const m = await api(`/conversations/${c.id}/messages`, input);
  assert.equal((await api(`/conversations/${c.id}/messages`, input)).id, m.id);
  return { c, m };
}

try {
  assert.equal((await api('/development/status')).available, true);
  const { c, m } = await start(
    'mission-development : ajoute une note de recette dans un nouveau fichier.',
  );
  const result = await until(
    () => api(`/missions/${m.id}`),
    (m) => ['succeeded', 'failed', 'cancelled'].includes(m.status),
    180000,
  );
  assert.equal(result.status, 'succeeded');
  const detail = await api(`/conversations/${c.id}`);
  const change = detail.changes[0];
  assert.equal(change.status, 'proposed', JSON.stringify(change));
  assert.equal(change.validation.passed, true);
  assert.equal(change.review.verdict, 'approve');
  assert.match(change.artifact.patch, /Development fixture/);
  const patch = await fetch(base + `/api/v1/development/${change.id}/patch`, { headers });
  assert.equal(patch.status, 200);
  assert.equal(await patch.text(), change.artifact.patch);
  console.log(
    'PASS: Temporal -> Codex fixture -> isolated Git/shell/write -> frozen patch -> baseline tests -> independent review -> authenticated download.',
  );
  const cancel = await start('mission-development attends : test de l’arrêt de la commande.');
  const d = await until(
    () => api(`/conversations/${cancel.c.id}`),
    (d) => d.changes.length > 0,
  );
  await until(
    async () =>
      execFileSync(
        'docker',
        ['ps', '-q', '--filter', `label=jarvis.development=${d.changes[0].id}`],
        { encoding: 'utf8' },
      ).trim(),
    (x) => Boolean(x),
  );
  await api(`/missions/${cancel.m.id}/commands`, { command: 'cancel' });
  const stopped = await until(
    () => api(`/missions/${cancel.m.id}`),
    (m) => ['succeeded', 'failed', 'cancelled'].includes(m.status),
    90000,
  );
  assert.equal(stopped.status, 'cancelled');
  assert.equal((await api(`/conversations/${cancel.c.id}`)).changes[0].status, 'cancelled');
  assert.equal(
    execFileSync(
      'docker',
      ['ps', '-q', '--filter', `label=jarvis.development=${d.changes[0].id}`],
      { encoding: 'utf8' },
    ).trim(),
    '',
  );
  console.log('PASS: cancellation confirms tool containers stopped; no final reply or release.');
} finally {
  await api('/auth/logout', {});
}
