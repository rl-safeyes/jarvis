import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AgentRepository } from '../../../packages/storage/src/agents.ts';
import { createAgentRequestSchema } from '../../../packages/contracts/src/agents.ts';
import { DomainError } from '@jarvis/storage';
export function registerAgentRoutes(
  app: FastifyInstance,
  repo: AgentRepository,
  mode: 'mock' | 'live',
) {
  app.get('/api/v1/agents', async () => ({ ...(await repo.catalogue()), mode }));
  app.post('/api/v1/agents', async (req, reply) => {
    if (mode !== 'live')
      throw new DomainError(409, 'live_required', 'La création nécessite le mode réel.');
    const { request_id, ...input } = createAgentRequestSchema.parse(req.body);
    return reply.code(201).send(await repo.create(request_id, input));
  });
  app.get('/api/v1/agents/:id/versions', async (req) =>
    repo.versions(
      z.object({ id: z.string().regex(/^[a-z][a-z0-9.-]{0,100}$/) }).parse(req.params).id,
    ),
  );
}
