import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool, Repository, migrate } from '@jarvis/storage';
import { HarnessRepository } from '../../packages/storage/src/harnesses.ts';
import { Orchestrator } from '../../apps/workflow-worker/orchestration.ts';
import { createApp } from '../../apps/api/src/app.ts';
if (!process.env.TEST_DATABASE_URL) throw new Error('Dedicated test database required');
const schema = `development_${randomUUID().replaceAll('-', '')}`;
const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const pool = new Pool({
  connectionString: process.env.TEST_DATABASE_URL,
  options: `-c search_path=${schema}`,
});
const repo = new Repository(pool, 'live');
before(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
  await migrate(pool);
  await migrate(pool);
  const h = new HarnessRepository(pool);
  await h.seed();
  await pool.query(
    "UPDATE harness_installations SET state='installed',image_digest='sha256:test' WHERE id='codex'",
  );
  const a = await h.createAccount({ id: randomUUID(), name: 'Development test', harness: 'codex' });
  await pool.query("UPDATE harness_accounts SET state='ready' WHERE id=$1", [a.id]);
  const p = await h.createProfile({
    id: randomUUID(),
    name: 'Development test',
    account_id: a.id,
    model: 'fixture-model',
  });
  await pool.query("UPDATE execution_profiles SET state='ready',tested_revision=0 WHERE id=$1", [
    p.id,
  ]);
  await h.setDefault(p.id, 0);
});
after(async () => {
  await pool.end();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
});
async function mission(development = true) {
  const c = await repo.createConversation(randomUUID(), 'Development');
  return repo.submit(c.id, {
    client_message_id: randomUUID(),
    text: 'Ajoute une note de documentation.',
    expected_conversation_version: 0,
    development,
  });
}
const action = {
  type: 'develop',
  agent_id: 'engineering.developer',
  reviewer_id: 'quality.reviewer',
  task: 'Ajoute une note de documentation.',
};
const output = (v: any) => ({ state: 'succeeded', text: JSON.stringify(v) });
class Fixture {
  calls = new Map<string, any>();
  tools: string[] = [];
  cancelled: string[] = [];
  passed = true;
  invalid = false;
  afterTool?: () => Promise<void>;
  crash = false;
  async call(i: any): Promise<any> {
    if (i.action === 'development_status')
      return { available: true, image_digest: 'sha256:' + '1'.repeat(64) };
    if (i.action === 'development_cancel' || i.action === 'cancel') {
      this.cancelled.push(i.id);
      return { state: 'cancelled' };
    }
    if (this.calls.has(i.id)) return this.calls.get(i.id);
    let r: any;
    if (i.action === 'development_operation') {
      const tool = i.operation.tool;
      this.tools.push(tool);
      const result =
        tool === 'initialize'
          ? { files: ['README.md'] }
          : tool === 'freeze'
            ? {
                patch: 'diff --git a/README.md b/README.md\n+test',
                digest: 'a'.repeat(64),
                commit: 'b'.repeat(40),
                base_commit: 'c'.repeat(40),
                files: ['README.md'],
              }
            : tool === 'validate'
              ? { passed: this.passed, exit_code: this.passed ? 0 : 1, output: 'Trusted check' }
              : { message: 'written' };
      r = { state: 'succeeded', result };
      if (tool === 'write' && this.afterTool) {
        await this.afterTool();
        r = { state: 'running' };
      }
    } else {
      const p = JSON.parse(i.prompt);
      if (p.role === 'development')
        r = output(
          p.history.length
            ? { type: 'done', summary: 'Note ajoutée' }
            : this.invalid
              ? { type: 'tool', operation: { tool: 'write', path: '../escape', content: 'x' } }
              : { type: 'tool', operation: { tool: 'write', path: 'README.md', content: 'Note' } },
        );
      else if (p.role === 'review') {
        assert.ok(p.artifact.patch);
        assert.equal(p.history, undefined);
        r = output({ verdict: 'approve', summary: 'Revue indépendante.' });
      } else
        r = output(
          p.completed_steps.length
            ? { type: 'reply', text: 'Proposition prête sans déploiement.' }
            : action,
        );
    }
    this.calls.set(i.id, r);
    if (this.crash && i.action === 'development_operation' && i.operation.tool === 'write') {
      this.crash = false;
      throw new Error('transport lost after write');
    }
    return r;
  }
}
test('development produces an immutable patch, trusted validation and an independent review', async () => {
  const m = await mission();
  const f = new Fixture();
  const engine = new Orchestrator(pool, f, () => {}, 1);
  assert.equal((await engine.execute(m.id)).state, 'succeeded');
  const change = (await repo.detail(m.conversation_id)).changes![0]!;
  assert.equal(change.status, 'proposed');
  assert.ok(change.artifact!.digest);
  assert.equal(change.validation!.passed, true);
  assert.deepEqual(f.tools, ['initialize', 'write', 'freeze', 'validate']);
  const count = f.calls.size;
  await engine.execute(m.id);
  assert.equal(f.calls.size, count);
});
test('an ordinary message cannot acquire development tools from a model decision', async () => {
  const m = await mission(false),
    f = new Fixture();
  const r = await new Orchestrator(pool, f, () => {}, 1).execute(m.id);
  assert.equal(r.state, 'failed');
  assert.match(r.error!, /Activez/);
  assert.equal(f.tools.length, 0);
});
test('tool effects survive a lost response without executing the write twice', async () => {
  const m = await mission(),
    f = new Fixture();
  f.crash = true;
  const e = new Orchestrator(pool, f, () => {}, 1);
  await assert.rejects(e.execute(m.id));
  assert.equal((await e.execute(m.id)).state, 'succeeded');
  assert.equal(f.tools.filter((t) => t === 'write').length, 1);
});
test('a model cannot turn failed checks into a ready proposal', async () => {
  const m = await mission(),
    f = new Fixture();
  f.passed = false;
  await new Orchestrator(pool, f, () => {}, 1).execute(m.id);
  assert.equal((await repo.detail(m.conversation_id)).changes![0]!.status, 'tests_failed');
});
test('invalid paths are rejected before the tool service is contacted', async () => {
  const m = await mission(),
    f = new Fixture();
  f.invalid = true;
  const r = await new Orchestrator(pool, f, () => {}, 1).execute(m.id);
  assert.equal(r.state, 'failed');
  assert.deepEqual(f.tools, ['initialize']);
  assert.equal((await repo.detail(m.conversation_id)).changes![0]!.status, 'failed');
});
test('cancelling a running shell confirms stop and prevents review and final reply', async () => {
  const m = await mission(),
    f = new Fixture();
  f.afterTool = async () => {
    await repo.cancel(m.id);
  };
  const r = await new Orchestrator(pool, f, () => {}, 1).execute(m.id);
  assert.equal(r.state, 'cancelled');
  assert.equal(f.cancelled.length, 1);
  assert.equal((await repo.detail(m.conversation_id)).changes![0]!.status, 'cancelled');
  assert.ok(!f.tools.includes('freeze'));
});
test('development authorization is part of message idempotency', async () => {
  const c = await repo.createConversation(randomUUID(), 'Idempotence');
  const i = { client_message_id: randomUUID(), text: 'Une note', expected_conversation_version: 0 };
  await repo.submit(c.id, i);
  await assert.rejects(repo.submit(c.id, { ...i, development: true }), {
    code: 'idempotency_conflict',
  });
});
test('patch downloads require the owner session', async () => {
  const m = await mission();
  await new Orchestrator(pool, new Fixture(), () => {}, 1).execute(m.id);
  const c = (await repo.detail(m.conversation_id)).changes![0]!;
  const app = await createApp({
    repo,
    password: 'integration-password-123',
    origin: 'http://localhost:5173',
    mode: 'live',
  });
  try {
    assert.equal((await app.inject({ url: `/api/v1/development/${c.id}/patch` })).statusCode, 401);
  } finally {
    await app.close();
  }
});

test('developer instructions and profile stay frozen across tool turns', async () => {
  const m = await mission(),
    f = new Fixture();
  const h = new HarnessRepository(pool);
  const bridge = {
    call: async (input: any) => {
      const result = await f.call(input);
      if (input.action === 'development_operation' && input.operation.tool === 'write') {
        const current = (
          await pool.query("SELECT revision FROM agent_configs WHERE id='engineering.developer'")
        ).rows[0];
        await h.setAgent(
          'engineering.developer',
          'Instructions modifiées pendant le travail.',
          null,
          current.revision,
        );
      }
      return result;
    },
  };
  assert.equal(
    (await new Orchestrator(pool, bridge, () => {}, 1).execute(m.id)).state,
    'succeeded',
  );
  const rows = (
    await pool.query(
      "SELECT runtime FROM mission_steps WHERE mission_id=$1 AND kind='developer' ORDER BY sequence",
      [m.id],
    )
  ).rows;
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].runtime, rows[1].runtime);
});
