import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { submitMessageSchema } from '@jarvis/contracts';
import { readConfig } from '../../apps/api/src/config.ts';
import { MockHarness } from '@jarvis/harness-mock';

test('rejects empty, oversized and unexpected message fields', () => {
  const base = { client_message_id: randomUUID(), expected_conversation_version: 0 };
  assert.equal(submitMessageSchema.safeParse({ ...base, text: '  ' }).success, false);
  assert.equal(submitMessageSchema.safeParse({ ...base, text: 'x'.repeat(8001) }).success, false);
  assert.equal(
    submitMessageSchema.safeParse({ ...base, text: 'test', admin: true }).success,
    false,
  );
  assert.equal(submitMessageSchema.parse({ ...base, text: ' test ' }).text, 'test');
});
test('rejects live harnesses and insecure non-local origins', () => {
  const env = {
    DATABASE_URL: 'postgresql://localhost/jarvis',
    JARVIS_OWNER_PASSWORD: 'a-long-test-password-only',
  };
  assert.throws(() => readConfig({ ...env, HARNESS_MODE: 'codex' }));
  assert.throws(() => readConfig({ ...env, APP_ORIGIN: 'http://jarvis.example.com' }));
  assert.throws(() => readConfig({ ...env, APP_ORIGIN: 'https://jarvis.example.com/path' }));
  assert.equal(readConfig({ ...env, APP_ORIGIN: 'https://jarvis.example.com' }).secureCookie, true);
});
test('simulator labels its output and supports cancellation', async () => {
  const harness = new MockHarness(1);
  const controller = new AbortController();
  const events = [];
  for await (const event of harness.execute({
    runId: randomUUID(),
    prompt: 'Bonjour',
    signal: controller.signal,
  }))
    events.push(event);
  assert.equal(events.length, 4);
  const result = events.at(-1)!;
  assert.equal(result.type, 'result');
  if (result.type === 'result') assert.match(result.text, /aucun modèle IA/);
  const stopped = new AbortController();
  stopped.abort();
  await assert.rejects(async () => {
    for await (const _ of harness.execute({
      runId: randomUUID(),
      prompt: 'Stop',
      signal: stopped.signal,
    }))
      assert.fail('Should not emit');
  });
});
