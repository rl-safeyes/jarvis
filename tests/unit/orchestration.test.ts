import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDecision, createAgentSchema } from '../../packages/contracts/src/agents.ts';
test('only validated structured decisions can create or delegate; no arbitrary tools', () => {
  assert.equal(parseDecision('Bonjour').type, 'reply');
  assert.equal(
    parseDecision(
      '```json\n{"type":"delegate","agent_id":"produit.analyste","task":"Analyse ceci"}\n```',
    ).type,
    'delegate',
  );
  assert.throws(() => parseDecision('{"type":"shell","command":"whoami"}'));
  assert.throws(() =>
    parseDecision(
      '{"type":"delegate","agent_id":"produit.analyste","task":"ok","tools":["shell"]}',
    ),
  );
  assert.throws(() =>
    createAgentSchema.parse({
      name: 'Agent',
      department: 'Produit',
      description: 'Rôle',
      instructions: 'Rôle très précis',
      tools: ['shell'],
    }),
  );
  assert.throws(() => parseDecision('{"type":"reply","text":""}'));
});
