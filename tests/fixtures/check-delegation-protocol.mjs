import { parseEnv } from 'node:util';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const cfg = parseEnv(readFileSync('.env', 'utf8'));
const base = 'http://localhost:3303';
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

const jarvisContainer = `jarvis-delegation-fixture-account-${account.id}`;
const final = async (m) =>
  until(
    () => api(`/missions/${m.id}`),
    (m) => ['succeeded', 'failed', 'cancelled'].includes(m.status),
    90000,
  );
let { c, m } = await start(
  'mission-delegation : crée un analyste puis délègue la rédaction des critères',
);
let result = await final(m);
assert.equal(result.status, 'succeeded');
assert.match(result.result, /Résultat du spécialiste/);
let detail = await api(`/conversations/${c.id}`);
assert.equal(detail.tasks.filter((t) => t.kind === 'create_agent').length, 1);
assert.equal(detail.tasks.filter((t) => t.kind === 'delegate').length, 1);
assert.equal(detail.tasks.filter((t) => t.kind === 'orchestrator').length, 3);
assert.equal(
  (await api('/agents')).agents.filter((a) => a.id === 'produit-recette.analyste-recette').length,
  1,
);
console.log('Creation, delegation and synthesis passed through Temporal and Docker.');
({ c, m } = await start('mission-delegation attends : annulation du spécialiste'));
await until(
  () => api(`/conversations/${c.id}`),
  (d) => d.tasks.some((t) => t.kind === 'delegate' && t.status === 'running'),
);
await api(`/missions/${m.id}/commands`, { command: 'cancel' });
result = await final(m);
assert.equal(result.status, 'cancelled');
assert.equal(
  (await api(`/conversations/${c.id}`)).tasks.find((t) => t.kind === 'delegate').status,
  'cancelled',
);
console.log('Child cancellation confirmed, no parent response published.');
({ c, m } = await start('mission-delegation attends : reprise du spécialiste'));
detail = await until(
  () => api(`/conversations/${c.id}`),
  (d) => d.tasks.some((t) => t.kind === 'delegate' && t.status === 'running'),
);
const child = detail.tasks.find((t) => t.kind === 'delegate');
await until(
  async () =>
    JSON.parse(
      execFileSync('docker', ['exec', '-i', jarvisContainer, 'node', '/runtime/request.mjs'], {
        input: JSON.stringify({ action: 'run', id: child.id }),
        encoding: 'utf8',
      }),
    ).result,
  (r) => r.state === 'running',
);
const starts = () =>
  Number(
    execFileSync('docker', ['exec', jarvisContainer, 'cat', '/home/node/jarvis/fixture-starts'], {
      encoding: 'utf8',
    }),
  );
const before = starts();
execFileSync('docker', ['kill', '--signal', 'KILL', 'jarvis-delegation-test_worker_1'], {
  stdio: 'ignore',
});
execFileSync('docker', ['start', 'jarvis-delegation-test_worker_1'], { stdio: 'ignore' });
result = await final(m);
assert.equal(result.status, 'succeeded');
assert.equal(starts(), before + 1, 'Only the final synthesis should start after restart');
console.log('Worker restart resumed the child without repeating inference or agent creation.');
await api('/auth/logout', {});
console.log('Delegation protocol checks passed. Test profile remains available for UI checks.');
