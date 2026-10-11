import { parseEnv } from 'node:util';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const cfg = parseEnv(readFileSync('.env', 'utf8'));
const base = 'http://localhost:3301';
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
  const input = { client_message_id: randomUUID(), text, expected_conversation_version: 0 };
  const m = await api(`/conversations/${c.id}/messages`, input);
  assert.equal((await api(`/conversations/${c.id}/messages`, input)).id, m.id);
  return { c, m };
}
let { c, m } = await start('Bonjour');
let finished = await until(
  () => api(`/missions/${m.id}`),
  (x) => ['succeeded', 'failed', 'cancelled'].includes(x.status),
);
assert.equal(finished.status, 'succeeded');
assert.match(finished.result, /pair de test/);
assert.equal(
  (await api(`/conversations/${c.id}`)).messages.filter((x) => x.role === 'assistant').length,
  1,
);
console.log('Live chat persists one response for duplicate submission.');
({ c, m } = await start('attends avant de répondre'));
await until(
  () => api(`/missions/${m.id}`),
  (x) => x.status === 'running',
);
await api(`/missions/${m.id}/commands`, { command: 'cancel' });
finished = await until(
  () => api(`/missions/${m.id}`),
  (x) => x.status === 'cancelled',
);
assert.equal(finished.result, null);
console.log('Cancellation reaches the runtime and prevents late completion.');
({ c, m } = await start('attends puis réponds après redémarrage'));
const container = `jarvis-protocol-fixture-account-${account.id}`;
const runningDetail = await until(
  () => api(`/conversations/${c.id}`),
  (d) => d.tasks?.some((t) => t.kind === 'orchestrator'),
);
const nativeId = runningDetail.tasks.find((t) => t.kind === 'orchestrator').id;
await until(
  async () =>
    JSON.parse(
      execFileSync('docker', ['exec', '-i', container, 'node', '/runtime/request.mjs'], {
        input: JSON.stringify({ action: 'run', id: nativeId }),
        encoding: 'utf8',
      }),
    ),
  (x) => x.result?.state === 'running',
);
const countBefore = Number(
  execFileSync('docker', ['exec', container, 'cat', '/home/node/jarvis/fixture-starts'], {
    encoding: 'utf8',
  }),
);
execFileSync('docker', ['kill', '--signal', 'KILL', 'jarvis-harness-test_worker_1'], {
  stdio: 'ignore',
});
execFileSync('docker', ['start', 'jarvis-harness-test_worker_1'], { stdio: 'ignore' });
finished = await until(
  () => api(`/missions/${m.id}`),
  (x) => ['succeeded', 'failed'].includes(x.status),
  90000,
);
assert.equal(finished.status, 'succeeded');
const countAfter = Number(
  execFileSync('docker', ['exec', container, 'cat', '/home/node/jarvis/fixture-starts'], {
    encoding: 'utf8',
  }),
);
assert.equal(countAfter, countBefore);
console.log('Worker crash recovered through Temporal without a second inference.');
await api(`/accounts/${account.id}/disconnect`, {});
assert.equal((await api(`/accounts/${account.id}/status`)).state, 'disconnected');
d = await api('/harnesses');
assert.equal(d.profiles.find((p) => p.id === profile.id).state, 'untested');
await api('/runtime-settings', { profile_id: null, expected_revision: d.settings.revision });
await api('/auth/logout', {});
console.log('Revocation invalidates the profile; setup remains reachable.');
