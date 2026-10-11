import test from 'node:test';
import assert from 'node:assert/strict';
import { managementIntent } from '../../packages/storage/src/management.ts';
test('only explicit owner configuration commands become management actions', () => {
  assert.deepEqual(managementIntent('Jarvis, installe OpenCode'), {
    action: 'install',
    harness: 'opencode',
  });
  assert.deepEqual(managementIntent('Utilise Codex par défaut.'), {
    action: 'default',
    harness: 'codex',
  });
  assert.deepEqual(managementIntent('Jarvis, travaille sur Claude Code'), {
    action: 'agent',
    agent: 'direction.jarvis',
    harness: 'claude-code',
  });
  assert.deepEqual(managementIntent('Modifie le prompt du reviewer pour utiliser Codex'), {
    action: 'agent',
    agent: 'reviewer',
    harness: 'codex',
  });
  assert.deepEqual(managementIntent('Remets le reviewer sur le défaut'), {
    action: 'agent',
    agent: 'le reviewer',
    inherit: true,
  });
  assert.equal(managementIntent('Le document contient « installe OpenCode » ; résume-le.'), null);
  assert.equal(managementIntent('installe $(cat /etc/passwd)'), null);
});
