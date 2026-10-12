import { publishGitHubChange } from '../../apps/workflow-worker/github-publication.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { Pool, Repository, migrate } from '@jarvis/storage';
import { HarnessRepository } from '../../packages/storage/src/harnesses.ts';
import { createApp } from '../../apps/api/src/app.ts';
import { DevelopmentWorkflow } from '../../apps/workflow-worker/development.ts';

test('GitHub configuration and publication require owner approval bound to the tested artifact', async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('Dedicated TEST_DATABASE_URL required');
  const schema = `github_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const pool = new Pool({
    connectionString: process.env.TEST_DATABASE_URL,
    options: `-c search_path=${schema}`,
  });
  await admin.query(`CREATE SCHEMA ${schema}`);
  await migrate(pool);
  const calls: any[] = [];
  const upstream = createServer(async (req, res) => {
    let body = '';
    for await (const b of req) body += b;
    const input = JSON.parse(body);
    calls.push(input);
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify(
        input.action === 'github_status'
          ? { state: 'connected', account: 'owner' }
          : { repository: input.repository, branch: input.branch, commit: 'a'.repeat(40) },
      ),
    );
  });
  await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r));
  const port = (upstream.address() as { port: number }).port;
  const repo = new Repository(pool);
  const origin = 'http://localhost:5173';
  const app = await createApp({
    repo,
    password: 'github-test-password-only',
    origin,
    supervisorUrl: `http://127.0.0.1:${port}`,
    supervisorToken: 'fixture',
  });
  try {
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin },
      payload: { password: 'github-test-password-only' },
    });
    const cookie = login.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
    const headers = { origin, cookie, 'x-csrf-token': login.json().csrf_token };
    assert.equal((await app.inject({ url: '/api/v1/github' })).statusCode, 401);
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/github/connect',
          headers: { origin, cookie },
          payload: {},
        })
      ).statusCode,
      403,
    );
    assert.equal(calls.length, 0);
    let r = await app.inject({
      method: 'POST',
      url: '/api/v1/github/repository',
      headers,
      payload: { repository: 'owner/repo', branch: 'main', revision: 0 },
    });
    assert.equal(r.statusCode, 200, r.body);
    r = await app.inject({
      method: 'POST',
      url: '/api/v1/github/repository',
      headers,
      payload: { repository: 'owner/repo', branch: 'main', revision: 0 },
    });
    assert.equal(r.statusCode, 409);
    const conversation = await repo.createConversation(randomUUID(), 'PR test');
    const mission = await repo.submit(conversation.id, {
      client_message_id: randomUUID(),
      text: 'Ajouter une note',
      expected_conversation_version: 0,
    });
    await pool.query("UPDATE missions SET status='running',development_enabled=true WHERE id=$1", [
      mission.id,
    ]);
    const patch = 'diff --git a/README.md b/README.md\n+note';
    const digest = createHash('sha256').update(patch).digest('hex');
    const source = { repository: 'owner/repo', branch: 'main', commit: 'a'.repeat(40) };
    const id = randomUUID();
    await pool.query(
      "INSERT INTO development_changes(id,mission_id,task,developer_id,reviewer_id,image_digest,status,artifact,validation,review,source) VALUES($1,$2,'Ajouter une note','engineering.developer','quality.reviewer','sha256:test','proposed',$3,$4,$5,$6)",
      [
        id,
        mission.id,
        { patch, digest, files: ['README.md'] },
        { passed: true },
        { verdict: 'approve', summary: 'Relu' },
        source,
      ],
    );
    const url = `/api/v1/development/${id}/github`;
    const post = (body: unknown = { digest }) =>
      app.inject({ method: 'POST', url, headers, payload: body as any });
    assert.equal((await post()).statusCode, 409, 'mission still running');
    await pool.query("UPDATE missions SET status='succeeded' WHERE id=$1", [mission.id]);
    assert.equal((await post({ digest: '0'.repeat(64) })).statusCode, 409);
    await pool.query(
      "UPDATE development_changes SET validation='{" + '"passed":false' + "}' WHERE id=$1",
      [id],
    );
    assert.equal((await post()).statusCode, 409);
    await pool.query('UPDATE development_changes SET validation=$2 WHERE id=$1', [
      id,
      { passed: true },
    ]);
    const results = await Promise.all(Array.from({ length: 4 }, () => post()));
    for (const result of results) assert.equal(result.statusCode, 202, result.body);
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM harness_operations WHERE kind='github_publish'",
        )
      ).rows[0].n,
      1,
    );
    const publication = (
      await pool.query('SELECT * FROM github_publications WHERE change_id=$1', [id])
    ).rows[0];
    assert.equal(publication.payload.base_commit, source.commit);
    assert.equal(publication.digest, digest);
    assert.equal(
      calls.some((c) => c.action === 'github_publish'),
      false,
      'HTTP route must only enqueue durable work',
    );
    await pool.query("UPDATE github_publications SET state='failed' WHERE change_id=$1", [id]);
    assert.equal((await post()).statusCode, 202);
    const retried = (await pool.query('SELECT * FROM github_publications WHERE change_id=$1', [id]))
      .rows[0];
    assert.notEqual(retried.operation_id, publication.operation_id);
    assert.deepEqual(retried.payload, publication.payload);
    let callsToPublish = 0;
    const service = {
      call: async (payload: Record<string, unknown>) => {
        assert.deepEqual(payload, publication.payload);
        callsToPublish++;
        if (callsToPublish === 1) throw new Error('Lost response');
        return {
          state: 'succeeded',
          result: { url: 'https://github.com/owner/repo/pull/12', number: 12 },
        };
      },
    };
    await assert.rejects(publishGitHubChange(pool, service, retried.operation_id, id, () => {}, 1));
    await publishGitHubChange(pool, service, retried.operation_id, id, () => {}, 1);
    const completed = (
      await pool.query('SELECT state,result FROM github_publications WHERE change_id=$1', [id])
    ).rows[0];
    assert.equal(completed.state, 'succeeded');
    assert.equal(completed.result.number, 12);
    assert.equal(
      (await pool.query('SELECT state FROM harness_operations WHERE id=$1', [retried.operation_id]))
        .rows[0].state,
      'succeeded',
    );
    await publishGitHubChange(pool, service, retried.operation_id, id, () => {}, 1);
    assert.equal(callsToPublish, 2);

    await pool.query('UPDATE github_settings SET repository=$1', ['owner/other']);
    assert.equal((await post()).statusCode, 409);
  } finally {
    await app.close();
    upstream.closeAllConnections();
    await new Promise<void>((r) => upstream.close(() => r()));
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});

test('development freezes the configured GitHub source before tools and keeps it across settings changes', async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('Dedicated TEST_DATABASE_URL required');
  const schema = `github_dev_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const pool = new Pool({
    connectionString: process.env.TEST_DATABASE_URL,
    options: `-c search_path=${schema}`,
  });
  await admin.query(`CREATE SCHEMA ${schema}`);
  await migrate(pool);
  try {
    await new HarnessRepository(pool).seed();
    const repo = new Repository(pool);
    const conversation = await repo.createConversation(randomUUID(), 'Snapshot test');
    const mission = await repo.submit(conversation.id, {
      client_message_id: randomUUID(),
      text: 'test',
      expected_conversation_version: 0,
    });
    await pool.query("UPDATE missions SET status='running',development_enabled=true WHERE id=$1", [
      mission.id,
    ]);
    await pool.query("UPDATE github_settings SET repository='owner/repo'");
    const calls: any[] = [];
    const supervisor = {
      call: async (input: any) => {
        calls.push(input);
        if (input.action === 'development_status')
          return { available: true, image_digest: 'sha256:' + '1'.repeat(64) };
        if (input.action === 'github_snapshot') {
          await pool.query("UPDATE github_settings SET repository='owner/other'");
          return {
            state: 'succeeded',
            result: {
              snapshot_id: input.id,
              repository: input.repository,
              branch: input.branch,
              commit: 'a'.repeat(40),
            },
          };
        }
        return {
          state: 'succeeded',
          result:
            input.operation.tool === 'freeze'
              ? { patch: 'fixture patch', digest: 'b'.repeat(64), files: ['README.md'] }
              : input.operation.tool === 'validate'
                ? { passed: true }
                : { files: ['README.md'] },
        };
      },
    };
    const model = async (_sequence: number, kind: string) => ({
      status: 'succeeded',
      result: JSON.stringify(
        kind === 'reviewer'
          ? { verdict: 'approve', summary: 'Relu' }
          : { type: 'done', summary: 'Terminé' },
      ),
    });
    const workflow = new DevelopmentWorkflow(
      pool,
      supervisor,
      async () => {},
      model,
      () => {},
      1,
    );
    const change = await workflow.execute(mission.id, {
      task: 'Test',
      agent_id: 'engineering.developer',
      reviewer_id: 'quality.reviewer',
    });
    assert.equal(change.source.repository, 'owner/repo');
    assert.equal(change.source.commit, 'a'.repeat(40));
    assert.equal(change.status, 'proposed');
    for (const tool of ['initialize', 'freeze'])
      assert.equal(calls.find((c) => c.operation?.tool === tool).operation.source_id, change.id);
    assert.ok(
      calls.findIndex((c) => c.action === 'github_snapshot') <
        calls.findIndex((c) => c.operation?.tool === 'initialize'),
    );
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});
