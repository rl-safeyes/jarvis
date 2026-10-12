import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Pool, DomainError } from '@jarvis/storage';
import type { SupervisorClient } from './supervisor-client.ts';
export function registerDevelopmentRoutes(
  app: FastifyInstance,
  pool: Pool,
  supervisor: SupervisorClient,
) {
  app.get('/api/v1/development/status', async () =>
    supervisor.call({ action: 'development_status' }),
  );
  app.get('/api/v1/development/:id/patch', async (req, reply) => {
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const change = (await pool.query('SELECT artifact FROM development_changes WHERE id=$1', [id]))
      .rows[0];
    if (!change?.artifact) throw new DomainError(404, 'patch_missing', 'Aucun patch disponible.');
    return reply
      .header('Content-Disposition', `attachment; filename="jarvis-${id}.patch"`)
      .type('text/plain; charset=utf-8')
      .send(change.artifact.patch);
  });
}
