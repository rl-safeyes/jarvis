import Fastify from 'fastify';
import { registerHarnessRoutes } from './harness-routes.ts';
import { HarnessRepository } from '../../../packages/storage/src/harnesses.ts';
import { SupervisorClient } from './supervisor-client.ts';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import staticFiles from '@fastify/static';
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  commandSchema,
  createConversationSchema,
  idSchema,
  isTerminal,
  loginSchema,
  submitMessageSchema,
} from '@jarvis/contracts';
import { agents, departments } from '@jarvis/agent-registry';
import { DomainError, type Repository } from '@jarvis/storage';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const derive = promisify(scrypt);
declare module 'fastify' {
  interface FastifyRequest {
    ownerSession: { tokenHash: string; csrf_token: string; expires_at: Date } | null;
  }
}
interface Options {
  repo: Repository;
  password: string;
  origin: string;
  secureCookie?: boolean;
  logger?: boolean;
  serveWeb?: boolean;
  mode?: 'mock' | 'live';
  supervisorUrl?: string;
  supervisorToken?: string;
}
export async function createApp({
  repo,
  password,
  origin,
  secureCookie = false,
  logger = false,
  serveWeb = false,
  mode = 'mock',
  supervisorUrl = 'http://supervisor:7080',
  supervisorToken = '',
}: Options) {
  const app = Fastify({
    logger: logger
      ? {
          redact: [
            'req.headers.cookie',
            'req.headers.authorization',
            'req.headers["x-csrf-token"]',
            'res.headers["set-cookie"]',
          ],
        }
      : false,
    bodyLimit: 32_768,
    trustProxy: false,
  });
  const salt = randomBytes(32);
  const passwordHash = (await derive(password, salt, 32)) as Buffer;
  const streams = new Set<AbortController>();
  await app.register(cookie);
  await app.register(rateLimit, { max: 240, timeWindow: '1 minute' });
  app.decorateRequest('ownerSession', null);
  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/')) return;
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
    const path = request.url.split('?')[0];
    const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
    if (mutation && request.headers.origin !== origin)
      throw new DomainError(403, 'origin_denied', 'Origine de la requête refusée.');
    if (path === '/api/v1/auth/login') return;
    const rawToken = request.cookies.jarvis_session;
    if (!rawToken) throw new DomainError(401, 'unauthenticated', 'Connectez-vous pour continuer.');
    const tokenHash = digest(rawToken);
    const session = await repo.session(tokenHash);
    if (!session) throw new DomainError(401, 'unauthenticated', 'Votre session a expiré.');
    request.ownerSession = { ...session, tokenHash };
    if (mutation && request.headers['x-csrf-token'] !== session.csrf_token)
      throw new DomainError(403, 'csrf_denied', 'La protection de session a refusé cette requête.');
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof DomainError)
      return reply.code(error.status).send({ error: { code: error.code, message: error.message } });
    if (error instanceof z.ZodError)
      return reply.code(400).send({
        error: {
          code: 'invalid_request',
          message: 'Certains champs de la demande sont invalides.',
        },
      });
    const status =
      typeof error === 'object' && error !== null && 'statusCode' in error
        ? Number(error.statusCode)
        : 500;
    if (status >= 400 && status < 500)
      return reply.code(status).send({
        error: {
          code: status === 429 ? 'rate_limited' : 'invalid_request',
          message:
            status === 429 ? 'Trop de tentatives. Réessayez dans une minute.' : 'Requête invalide.',
        },
      });
    request.log.error({ err: error }, 'Request failed');
    return reply
      .code(500)
      .send({ error: { code: 'internal_error', message: 'Le service a rencontré une erreur.' } });
  });
  app.get('/healthz', async () => {
    await repo.pool.query('SELECT 1');
    return { status: 'ok' };
  });
  app.post(
    '/api/v1/auth/login',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const input = loginSchema.parse(request.body);
      const attempted = (await derive(input.password, salt, 32)) as Buffer;
      if (!timingSafeEqual(attempted, passwordHash))
        throw new DomainError(401, 'invalid_credentials', 'Mot de passe incorrect.');
      if (request.cookies.jarvis_session)
        await repo.deleteSession(digest(request.cookies.jarvis_session));
      const token = randomBytes(32).toString('base64url');
      const csrfToken = randomBytes(32).toString('base64url');
      const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);
      await repo.createSession(digest(token), csrfToken, expiresAt);
      reply.setCookie('jarvis_session', token, {
        httpOnly: true,
        secure: secureCookie,
        sameSite: 'strict',
        path: '/',
        maxAge: 8 * 60 * 60,
      });
      return {
        authenticated: true,
        csrf_token: csrfToken,
        mode,
        expires_at: expiresAt.toISOString(),
      };
    },
  );
  app.get('/api/v1/auth/session', async (request) => ({
    authenticated: true,
    csrf_token: request.ownerSession!.csrf_token,
    mode,
    expires_at: request.ownerSession!.expires_at.toISOString(),
  }));
  app.post('/api/v1/auth/logout', async (request, reply) => {
    await repo.deleteSession(request.ownerSession!.tokenHash);
    reply.clearCookie('jarvis_session', { path: '/' });
    return reply.code(204).send();
  });
  const harnessRepo = new HarnessRepository(repo.pool);
  await harnessRepo.seed();
  await registerHarnessRoutes(
    app,
    harnessRepo,
    new SupervisorClient(supervisorUrl, supervisorToken),
  );
  app.get('/api/v1/agents', async () => ({ agents, departments, mode }));
  app.get('/api/v1/conversations', async () => ({ conversations: await repo.listConversations() }));
  app.post('/api/v1/conversations', async (request, reply) => {
    const input = createConversationSchema.parse(request.body);
    return reply
      .code(201)
      .send(await repo.createConversation(input.client_conversation_id, input.title));
  });
  const pathId = (params: unknown) => z.object({ id: idSchema }).parse(params).id;
  app.get('/api/v1/conversations/:id', async (request) => repo.detail(pathId(request.params)));
  app.post('/api/v1/conversations/:id/messages', async (request, reply) =>
    reply
      .code(202)
      .send(await repo.submit(pathId(request.params), submitMessageSchema.parse(request.body))),
  );
  app.get('/api/v1/missions/:id', async (request) => repo.getMission(pathId(request.params)));
  app.post('/api/v1/missions/:id/commands', async (request) => {
    commandSchema.parse(request.body);
    return repo.cancel(pathId(request.params));
  });
  app.get('/api/v1/missions/:id/events', async (request, reply) => {
    const id = pathId(request.params);
    await repo.getMission(id);
    const cursor =
      request.headers['last-event-id'] ??
      z.object({ after: z.string().optional() }).parse(request.query).after ??
      '0';
    if (typeof cursor !== 'string' || !/^\d{1,9}$/.test(cursor))
      throw new DomainError(400, 'invalid_cursor', 'Curseur invalide.');
    if (streams.size >= 30)
      throw new DomainError(429, 'too_many_streams', 'Trop de connexions actives.');
    let after = Number(cursor);
    const abort = new AbortController();
    streams.add(abort);
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.write(': connected\n\n');
    const onClose = () => abort.abort();
    reply.raw.on('close', onClose);
    try {
      while (!abort.signal.aborted) {
        if (!(await repo.session(request.ownerSession!.tokenHash))) break;
        const current = await repo.getMission(id);
        const events = await repo.events(id, after);
        let congested = false;
        for (const event of events) {
          after = event.sequence;
          if (
            !reply.raw.write(
              `id: ${event.sequence}\nevent: mission\ndata: ${JSON.stringify(event)}\n\n`,
            )
          ) {
            congested = true;
            break;
          }
        }
        if (congested) break; // Client reconnects using its last received event ID.
        if (events.length < 200 && isTerminal(current.status)) {
          reply.raw.write('event: done\ndata: {}\n\n');
          break;
        }
        reply.raw.write(': heartbeat\n\n');
        await sleep(500, undefined, { signal: abort.signal });
      }
    } catch (error) {
      if (!abort.signal.aborted) request.log.error({ err: error }, 'Event stream interrupted');
    } finally {
      streams.delete(abort);
      reply.raw.off('close', onClose);
      reply.raw.end();
    }
  });
  app.addHook('preClose', async () => {
    for (const stream of streams) stream.abort();
  });
  if (serveWeb) {
    const root = fileURLToPath(new URL('../../web/dist/', import.meta.url));
    if (existsSync(root)) {
      await app.register(staticFiles, {
        root,
        setHeaders: (res) => {
          res.header('Cache-Control', 'no-cache');
          res.header('X-Content-Type-Options', 'nosniff');
          res.header('Referrer-Policy', 'same-origin');
          res.header('X-Frame-Options', 'DENY');
          res.header(
            'Content-Security-Policy',
            "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
          );
        },
      });
    }
  }
  return app;
}
