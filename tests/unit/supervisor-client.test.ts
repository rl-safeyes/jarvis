import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { SupervisorClient } from '../../apps/api/src/supervisor-client.ts';
import { DomainError } from '../../packages/storage/src/index.ts';

test('supervisor errors preserve safe categories without forwarding provider secrets', async (t) => {
  let body: unknown = {};
  let status = 503;
  const server = http.createServer((_req, res) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const client = new SupervisorClient(`http://127.0.0.1:${address.port}`, 'test-token');
  for (const code of [
    'runtime_tls_error',
    'runtime_network_error',
    'runtime_provider_refused',
    'unexpected_secret',
    '__proto__',
  ]) {
    body = {
      error_code: code,
      error: 'sk-private-token https://private.invalid/login?code=secret',
    };
    await assert.rejects(client.call({ action: 'connect' }), (error: unknown) => {
      assert.ok(error instanceof DomainError);
      assert.equal(error.code, code.startsWith('runtime_') ? code : 'runtime_unavailable');
      assert.doesNotMatch(error.message, /sk-private|private.invalid|unexpected_secret|__proto__/);
      return true;
    });
  }
  status = 200;
  body = { state: 'disconnected' };
  assert.deepEqual(await client.call({ action: 'status' }), body);
});
