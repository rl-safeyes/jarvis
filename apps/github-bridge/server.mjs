import http from 'node:http';
import * as fs from 'node:fs/promises';
import { createHash, timingSafeEqual } from 'node:crypto';
import { GitHubAuth } from './auth.mjs';
import { GitHubBridge } from './github.mjs';
const secret = process.env.JARVIS_SUPERVISOR_TOKEN;
if (!secret || secret.length < 32) throw new Error('Internal token required');
await fs.mkdir('/state', { recursive: true, mode: 0o700 });
const auth = new GitHubAuth('/state/auth');
const bridge = new GitHubBridge({ auth });
http
  .createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    if (req.url === '/healthz' && req.method === 'GET') return res.end('{"status":"ok"}');
    const hash = (x) => createHash('sha256').update(x).digest();
    if (!timingSafeEqual(hash(req.headers.authorization ?? ''), hash(`Bearer ${secret}`))) {
      res.statusCode = 401;
      return res.end('{}');
    }
    try {
      if (req.url !== '/request' || req.method !== 'POST')
        throw new Error('github_invalid_request');
      let text = '';
      for await (const b of req) {
        text += b;
        if (text.length > 1000000) throw new Error('github_invalid_request');
      }
      const input = JSON.parse(text);
      let result;
      switch (input.action) {
        case 'github_status':
          result = await auth.status();
          break;
        case 'github_connect':
          result = await auth.connect();
          break;
        case 'github_disconnect':
          result = await auth.disconnect();
          break;
        case 'github_repository':
          result = await bridge.checkRepository(input.repository, input.branch);
          break;
        case 'github_snapshot':
          result = await bridge.snapshot(input);
          break;
        case 'github_release_policy':
          result = await bridge.releasePolicy();
          break;
        case 'github_release_export':
          result = await bridge.exportRelease(input);
          break;
        case 'github_release_merge':
          result = await bridge.mergeRelease(input);
          break;
        case 'github_qualify':
          result = await bridge.qualify(input);
          break;
        case 'github_publish':
          result = await bridge.publish(input);
          break;
        default:
          throw new Error('github_invalid_request');
      }
      res.end(JSON.stringify(result));
    } catch (error) {
      res.statusCode = 503;
      res.end(
        JSON.stringify({
          error_code: /^github_[a-z_]+$/.test(error.message) ? error.message : 'github_unavailable',
        }),
      );
    }
  })
  .listen(7081, '0.0.0.0');
process.on('SIGTERM', () => {
  auth.cancel();
  process.exit(0);
});
