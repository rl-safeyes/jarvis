import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { Pool, Repository, migrate } from '@jarvis/storage';
import { createApp } from '../../apps/api/src/app.ts';
import { MAX_AUDIO_BYTES } from '../../apps/api/src/voice.ts';

test('voice endpoint protects binary uploads with owner session, origin, CSRF and size limits', async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('Dedicated TEST_DATABASE_URL required');
  const schema = `voice_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const pool = new Pool({
    connectionString: process.env.TEST_DATABASE_URL,
    options: `-c search_path=${schema}`,
  });
  const upstream = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ text: 'Bonjour Jarvis', duration: 2 }));
    });
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const port = (upstream.address() as { port: number }).port;
  await admin.query(`CREATE SCHEMA ${schema}`);
  await migrate(pool);
  const origin = 'http://localhost:5173';
  const app = await createApp({
    repo: new Repository(pool),
    password: 'voice-test-password-only',
    origin,
    voice: { url: `http://127.0.0.1:${port}`, model: 'Systran/faster-whisper-small' },
  });
  try {
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin },
      payload: { password: 'voice-test-password-only' },
    });
    const cookie = login.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
    const headers = {
      origin,
      cookie,
      'x-csrf-token': login.json().csrf_token,
      'content-type': 'audio/webm;codecs=opus',
    };
    const request = {
      method: 'POST' as const,
      url: '/api/v1/voice/transcriptions',
      payload: Buffer.from('fixture-audio'),
    };
    assert.equal(
      (await app.inject({ ...request, headers: { origin, 'content-type': 'audio/webm' } }))
        .statusCode,
      401,
    );
    assert.equal(
      (await app.inject({ ...request, headers: { ...headers, origin: 'https://evil.example' } }))
        .statusCode,
      403,
    );
    assert.equal(
      (await app.inject({ ...request, headers: { ...headers, 'x-csrf-token': 'bad' } })).statusCode,
      403,
    );
    for (let i = 0; i < 100; i++) {
      if (
        (await app.inject({ url: '/api/v1/voice/status', headers: { cookie } })).json().state ===
        'ready'
      )
        break;
      await new Promise((r) => setTimeout(r, 10));
    }
    const result = await app.inject({ ...request, headers });
    assert.equal(result.statusCode, 200, result.body);
    assert.equal(result.json().text, 'Bonjour Jarvis');
    assert.equal(result.headers['cache-control'], 'no-store');
    assert.equal(
      (await app.inject({ ...request, headers, payload: Buffer.alloc(MAX_AUDIO_BYTES + 1) }))
        .statusCode,
      413,
    );
    assert.equal(
      (await app.inject({ ...request, headers, payload: Buffer.alloc(0) })).statusCode,
      400,
    );
    assert.equal(
      (
        await app.inject({
          ...request,
          headers: { ...headers, 'content-type': 'application/json' },
          payload: { file: 'bad' },
        })
      ).statusCode,
      415,
    );
    assert.equal(
      (await app.inject({ ...request, headers: { ...headers, 'content-type': 'audio/mpeg' } }))
        .statusCode,
      415,
    );
  } finally {
    await app.close();
    upstream.closeAllConnections();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});
