import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { transaction, DomainError } from '@jarvis/storage';
import {
  accountSchema,
  profileSchema,
  selectionSchema,
  agentConfigSchema,
  connectSchema,
  harnessId,
} from '../../../packages/contracts/src/harnesses.ts';
import { HarnessRepository } from '../../../packages/storage/src/harnesses.ts';
import { SupervisorClient } from './supervisor-client.ts';

export async function registerHarnessRoutes(
  app: FastifyInstance,
  repo: HarnessRepository,
  supervisor: SupervisorClient,
) {
  const id = (p: unknown) => z.object({ id: z.uuid() }).parse(p).id;
  app.get('/api/v1/harnesses', () => repo.dashboard());
  app.post('/api/v1/harness-installations', async (req, reply) => {
    const b = z.object({ id: z.uuid(), harness: harnessId }).strict().parse(req.body);
    const op = await repo.operation(b.id, 'install', { harness: b.harness });
    return reply.code(202).send({ id: op.id, state: op.state });
  });
  app.post('/api/v1/accounts', async (req, reply) =>
    reply.code(201).send(await repo.createAccount(accountSchema.parse(req.body))),
  );
  app.get('/api/v1/accounts/:id/status', async (req) => {
    const a = await repo.account(id(req.params));
    if (a.state === 'disabled') return { state: 'disconnected', login: null };
    const state = await supervisor.call({ action: 'status', harness: a.harness, account_id: a.id });
    await repo.pool.query(
      "UPDATE harness_accounts SET state=$2 WHERE id=$1 AND state<>'disabled' AND revision=$3",
      [a.id, state.state, a.revision],
    );
    return state;
  });
  app.get('/api/v1/accounts/:id/models', async (req) => {
    const a = await repo.account(id(req.params));
    return supervisor.call({ action: 'models', harness: a.harness, account_id: a.id });
  });
  app.post('/api/v1/accounts/:id/connect', async (req) => {
    const b = connectSchema.parse(req.body);
    const accountId = id(req.params);
    return transaction(repo.pool, async (c) => {
      const a = (
        await c.query('SELECT * FROM harness_accounts WHERE id=$1 FOR UPDATE', [accountId])
      ).rows[0];
      if (!a) throw new DomainError(404, 'account_missing', 'Compte introuvable.');
      if (b.method === 'device' && a.harness !== 'codex')
        throw new DomainError(
          400,
          'unsupported_auth',
          'Ce moteur utilise actuellement une clé API dans Jarvis.',
        );
      const result = await supervisor.call({
        action: 'connect',
        harness: a.harness,
        account_id: a.id,
        ...b,
      });
      await c.query('UPDATE harness_accounts SET state=$2,revision=revision+1 WHERE id=$1', [
        a.id,
        b.method === 'device' ? 'connecting' : 'ready',
      ]);
      return result;
    });
  });
  app.post('/api/v1/accounts/:id/disconnect', async (req) => {
    const a = await repo.account(id(req.params));
    // Revoke local permission first even if the runtime is temporarily unavailable.
    await repo.pool.query(
      "UPDATE harness_accounts SET state='disabled',revision=revision+1 WHERE id=$1",
      [a.id],
    );
    await repo.pool.query(
      "UPDATE missions SET status='cancel_requested' WHERE runtime->>'account_id'=$1 AND status IN ('running','queued')",
      [a.id],
    );
    return supervisor.call({ action: 'disconnect', harness: a.harness, account_id: a.id });
  });
  app.post('/api/v1/execution-profiles', async (req, reply) =>
    reply.code(201).send(await repo.createProfile(profileSchema.parse(req.body))),
  );
  app.post('/api/v1/execution-profiles/:id/test', async (req, reply) => {
    const b = z.object({ id: z.uuid() }).strict().parse(req.body);
    const op = await repo.test(b.id, id(req.params));
    return reply.code(202).send({ id: op.id, state: op.state });
  });
  app.post('/api/v1/runtime-settings', async (req) => {
    const b = selectionSchema.parse(req.body);
    await repo.setDefault(b.profile_id, b.expected_revision);
    return repo.dashboard();
  });
  app.post('/api/v1/agents/:id/runtime', async (req) => {
    const agentId = z
      .object({ id: z.string().regex(/^[a-z][a-z0-9.-]{0,100}$/) })
      .parse(req.params).id;
    const b = agentConfigSchema.parse(req.body);
    await repo.setAgent(agentId, b.instructions, b.profile_id, b.expected_revision);
    return repo.dashboard();
  });
}
