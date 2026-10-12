import test from 'node:test';
import assert from 'node:assert/strict';
import {
  developmentToolSchema,
  parseDevelopmentDecision,
  reviewSchema,
} from '../../packages/contracts/src/development.ts';
test('development actions strictly bound tools, paths and output, refusing invented grants', () => {
  for (const path of [
    '/etc/passwd',
    '../secret',
    'a/../../x',
    '.git/config',
    'node_modules/x',
    'a\\b',
    'a\u0000b',
  ])
    assert.equal(developmentToolSchema.safeParse({ tool: 'read', path }).success, false);
  assert.equal(
    developmentToolSchema.safeParse({ tool: 'exec', command: 'git diff', network: true }).success,
    false,
  );
  assert.equal(developmentToolSchema.safeParse({ tool: 'docker', command: 'ps' }).success, false);
  assert.throws(() => parseDevelopmentDecision('J’ai modifié le code'));
  assert.equal(
    parseDevelopmentDecision('{"type":"tool","operation":{"tool":"read","path":"README.md"}}').type,
    'tool',
  );
  assert.equal(
    reviewSchema.safeParse({ verdict: 'approve', summary: 'ok', deploy: true }).success,
    false,
  );
});
