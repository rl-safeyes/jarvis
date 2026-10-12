import http from 'node:http';
import { ClaudeAuth, claudeEnvironment } from './claude-auth.mjs';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdir, readFile, writeFile, rename, readdir, unlink } from 'node:fs/promises';
import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const provider = process.env.JARVIS_HARNESS;
const stateDir = '/home/node/jarvis';
await mkdir(stateDir, { recursive: true, mode: 0o700 });
const ledger = new Map();
let active = null;
let login = null;
let rpc = null;
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function persist(run) {
  const path = `${stateDir}/${run.id}.json`;
  await writeFile(`${path}.tmp`, JSON.stringify(run), { mode: 0o600 });
  await rename(`${path}.tmp`, path);
}
for (const file of await readdir(stateDir)) {
  if (!/^[a-f0-9-]{36}\.json$/.test(file)) continue;
  const run = JSON.parse(await readFile(`${stateDir}/${file}`, 'utf8'));
  if (run.state === 'running') {
    run.state = 'failed';
    run.error = 'Exécution interrompue avec résultat inconnu ; aucun nouvel appel automatique.';
    await persist(run);
  }
  ledger.set(run.id, run);
}
function checkId(id) {
  if (
    typeof id !== 'string' ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)
  )
    throw new Error('invalid_id');
}
class CodexRpc {
  constructor() {
    this.pending = new Map();
    this.next = 0;
    this.listeners = new Set();
    const disabled = [
      'shell_tool',
      'unified_exec',
      'apps',
      'plugins',
      'multi_agent',
      'browser_use',
      'computer_use',
      'view_image',
      'image_generation',
      'code_mode_host',
      'hooks',
      'workspace_dependencies',
      'skill_search',
    ];
    this.child = spawn(
      'codex',
      [
        'app-server',
        '--listen',
        'stdio://',
        ...disabled.flatMap((x) => ['--disable', x]),
        '-c',
        'web_search="disabled"',
        '-c',
        'cli_auth_credentials_store="file"',
      ],
      {
        cwd: '/workspace',
        env: {
          PATH: process.env.PATH,
          LANG: 'C.UTF-8',
          SSL_CERT_FILE: '/etc/ssl/certs/ca-certificates.crt',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    // Never forward native stderr: it can contain auth URLs, private paths or provider diagnostics.
    this.child.stderr.resume();
    createInterface({ input: this.child.stdout }).on('line', (line) => {
      let data;
      try {
        data = JSON.parse(line);
      } catch {
        return;
      }
      if (data.id !== undefined && data.method) {
        this.child.stdin.write(
          JSON.stringify({
            id: data.id,
            error: { code: -32601, message: 'Outil indisponible dans cette version de Jarvis.' },
          }) + '\n',
        );
        return;
      }
      if (data.id !== undefined) {
        const item = this.pending.get(data.id);
        if (!item) return;
        this.pending.delete(data.id);
        clearTimeout(item.timer);
        if (data.error) {
          // Classify only; provider messages may contain credentials or login URLs.
          const message = String(data.error.message ?? '');
          const code = /certificate|unknown.?issuer/i.test(message)
            ? 'runtime_tls_error'
            : /error sending request|connect error|dns|timed? out/i.test(message)
              ? 'runtime_network_error'
              : 'runtime_provider_refused';
          item.reject(new Error(code));
        } else item.resolve(data.result);
      } else for (const listener of this.listeners) listener(data);
    });
    const closed = () => {
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(new Error('codex_unavailable'));
      }
      this.pending.clear();
      rpc = null;
    };
    this.child.on('error', closed);
    this.child.on('exit', closed);
  }
  request(method, params) {
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('codex_timeout'));
      }, 30000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
  }
  async init() {
    await this.request('initialize', { clientInfo: { name: 'jarvis', version: '0.2.0' } });
    this.child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
    this.listeners.add((event) => {
      if (event.method === 'account/login/completed' && login?.loginId === event.params.loginId)
        login = null;
    });
    return this;
  }
}
let starting;
async function codex() {
  if (rpc) return rpc;
  starting ??= new CodexRpc().init();
  try {
    rpc = await starting;
    return rpc;
  } finally {
    starting = null;
  }
}
function credentialKey() {
  const key = process.env.JARVIS_CREDENTIAL_KEY;
  if (!key || !/^[a-f0-9]{64}$/.test(key)) throw new Error('credential_key_required');
  return Buffer.from(key, 'hex');
}
async function saveCredentials(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', credentialKey(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  await writeFile(
    `${stateDir}/credential.json`,
    JSON.stringify({
      iv: iv.toString('hex'),
      tag: cipher.getAuthTag().toString('hex'),
      data: data.toString('hex'),
    }),
    { mode: 0o600 },
  );
}
async function credentials() {
  try {
    const value = JSON.parse(await readFile(`${stateDir}/credential.json`, 'utf8'));
    const decipher = createDecipheriv('aes-256-gcm', credentialKey(), Buffer.from(value.iv, 'hex'));
    decipher.setAuthTag(Buffer.from(value.tag, 'hex'));
    return JSON.parse(
      Buffer.concat([decipher.update(Buffer.from(value.data, 'hex')), decipher.final()]).toString(
        'utf8',
      ),
    );
  } catch {
    return null;
  }
}
const claudeAuth = new ClaudeAuth({
  readCredentials: credentials,
  saveCredentials,
  clearCredentials: () =>
    unlink(`${stateDir}/credential.json`).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    }),
});
async function status() {
  if (provider === 'claude-code') return claudeAuth.status();
  if (provider === 'codex') {
    const value = await (await codex()).request('account/read', { refreshToken: false });
    return {
      state: value.account ? 'ready' : login ? 'connecting' : 'disconnected',
      auth_method: value.account?.type ?? null,
      login,
    };
  }
  return {
    state: (await credentials()) ? 'ready' : 'disconnected',
    auth_method: 'api_key',
    login: null,
  };
}
async function runCodex(run, input) {
  const client = await codex();
  const { thread } = await client.request('thread/start', {
    model: input.model,
    cwd: '/workspace',
    sandbox: 'read-only',
    approvalPolicy: 'untrusted',
    ephemeral: true,
    developerInstructions: input.instructions,
    config: { web_search: 'disabled' },
  });
  const messages = new Map();
  let finish;
  const completed = new Promise((resolve, reject) => {
    finish = { resolve, reject };
  });
  const listener = (event) => {
    if (event.params?.threadId !== thread.id) return;
    if (event.method === 'item/completed' && event.params.item?.type === 'agentMessage')
      messages.set(event.params.item.id, event.params.item.text);
    if (event.method === 'turn/completed') {
      const turn = event.params.turn;
      turn.status === 'completed'
        ? finish.resolve([...messages.values()].join('\n\n'))
        : finish.reject(new Error('provider_failed'));
    }
  };
  client.listeners.add(listener);
  try {
    const { turn } = await client.request('turn/start', {
      threadId: thread.id,
      input: [{ type: 'text', text: input.prompt, text_elements: [] }],
    });
    active.cancel = async () => {
      await client.request('turn/interrupt', { threadId: thread.id, turnId: turn.id });
      finish.reject(new Error('cancelled'));
    };
    active.kill = () => {
      client.child.kill('SIGKILL');
      finish.reject(new Error('timeout'));
    };
    if (active.cancelRequested) await active.cancel();
    return await completed;
  } finally {
    client.listeners.delete(listener);
  }
}
async function runCli(run, input) {
  const auth = await credentials();
  if (!auth) throw new Error('auth_required');
  const env =
    provider === 'claude-code'
      ? claudeEnvironment()
      : { PATH: process.env.PATH, LANG: 'C.UTF-8', JARVIS_HARNESS: provider };
  // Provider config lives in the dedicated account volume; no host environment is inherited.
  let command, args;
  if (provider === 'claude-code') {
    command = 'claude';
    args = [
      '-p',
      '--output-format',
      'json',
      '--model',
      input.model,
      '--tools',
      '',
      '--strict-mcp-config',
      '--mcp-config',
      '{"mcpServers":{}}',
      '--permission-mode',
      'dontAsk',
      '--max-turns',
      '1',
      '--no-session-persistence',
      '--system-prompt',
      input.instructions,
    ];
    if (auth.method === 'claude_subscription') {
      if (!(await claudeAuth.nativeStatus())) throw new Error('auth_required');
      args.push(
        '--settings',
        JSON.stringify({ forceLoginMethod: 'claudeai', disableAllHooks: true }),
      );
    } else {
      if (!auth.secret) throw new Error('auth_required');
      env.ANTHROPIC_API_KEY = auth.secret;
      args.push(
        '--max-budget-usd',
        '0.50',
        '--settings',
        JSON.stringify({ disableAllHooks: true }),
      );
    }
  } else {
    command = 'opencode';
    args = ['run', '--format', 'json', '--model', input.model];
    env[auth.provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'] = auth.secret;
    env.OPENCODE_CONFIG_CONTENT = JSON.stringify({
      permission: { '*': 'deny' },
      share: 'disabled',
      autoupdate: false,
      agent: { build: { permission: { '*': 'deny' } } },
    });
    env.XDG_DATA_HOME = '/home/node/.local/share';
    env.XDG_CONFIG_HOME = '/home/node/.config';
    env.XDG_CACHE_HOME = '/home/node/.cache';
  }
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: '/workspace',
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
    });
    let output = '';
    child.stderr.resume();
    const kill = () => {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    };
    active.cancel = async () => {
      kill();
    };
    active.kill = kill;
    child.on('error', () => reject(new Error('provider_unavailable')));
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (output.length > 2_000_000) {
        kill();
        reject(new Error('output_limit'));
      }
    });
    child.on('exit', (code) => {
      if (code !== 0) return reject(new Error('provider_failed'));
      try {
        if (provider === 'claude-code') {
          const data = JSON.parse(output);
          if (data.is_error) throw new Error();
          resolve(data.result);
        } else {
          const events = output
            .trim()
            .split('\n')
            .map((x) => JSON.parse(x));
          if (events.some((x) => x.type === 'error')) throw new Error();
          resolve(
            events
              .filter((x) => x.type === 'text')
              .map((x) => x.part?.text ?? '')
              .join('\n'),
          );
        }
      } catch {
        reject(new Error('provider_failed'));
      }
    });
    child.stdin.end(`${input.instructions}\n\n${input.prompt}`);
    if (active.cancelRequested) kill();
  });
}
async function execute(run, input) {
  const timer = setTimeout(() => {
    active?.kill?.();
  }, 180000);
  try {
    const text = provider === 'codex' ? await runCodex(run, input) : await runCli(run, input);
    if (active?.cancelRequested) run.state = 'cancelled';
    else if (typeof text === 'string' && text.trim()) {
      run.state = 'succeeded';
      run.text = text.slice(0, 64000);
    } else throw new Error('empty_output');
  } catch {
    run.state = active?.cancelRequested ? 'cancelled' : 'failed';
    run.error =
      'Le moteur a interrompu la demande. Vérifiez la connexion, le modèle et les quotas.';
  } finally {
    clearTimeout(timer);
    await persist(run);
    active = null;
  }
}
async function dispatch(input) {
  switch (input.action) {
    case 'status':
      return status();
    case 'models': {
      if (provider === 'claude-code')
        return {
          models: [
            { id: 'sonnet', name: 'Claude Sonnet' },
            { id: 'opus', name: 'Claude Opus' },
          ],
        };
      if (provider !== 'codex') return { models: [] };
      const r = await (await codex()).request('model/list', {});
      return { models: (r.data ?? []).map((m) => ({ id: m.model, name: m.displayName })) };
    }
    case 'connect': {
      if (active) throw new Error('account_busy');
      if (provider === 'claude-code' && input.method === 'claude_subscription')
        return claudeAuth.begin();
      if (provider === 'codex') {
        if (login) return { login };
        const client = await codex();
        const r = await client.request(
          'account/login/start',
          input.method === 'device'
            ? { type: 'chatgptDeviceCode' }
            : { type: 'apiKey', apiKey: input.secret },
        );
        if (r.type === 'chatgptDeviceCode') {
          if (new URL(r.verificationUrl).origin !== 'https://auth.openai.com')
            throw new Error('invalid_auth_url');
          login = { ...r, expires_at: new Date(Date.now() + 15 * 60000).toISOString() };
        }
        return { login };
      }
      if (
        input.method !== 'api_key' ||
        typeof input.secret !== 'string' ||
        input.secret.length < 10
      )
        throw new Error('unsupported_auth');
      if (provider === 'opencode' && !['openai', 'anthropic'].includes(input.provider))
        throw new Error('provider_required');
      if (provider === 'claude-code') await claudeAuth.disconnect();
      await saveCredentials({ secret: input.secret, provider: input.provider });
      return { login: null };
    }
    case 'complete_login': {
      if (provider !== 'claude-code') throw new Error('unsupported_auth');
      if (active) throw new Error('account_busy');
      return claudeAuth.complete(input.loginId, input.code);
    }
    case 'disconnect': {
      if (active) {
        const current = active;
        current.cancelRequested = true;
        await current.cancel?.();
        current.kill?.();
      }
      if (provider === 'codex') {
        const c = await codex();
        if (login) await c.request('account/login/cancel', { loginId: login.loginId });
        await c.request('account/logout', {});
        login = null;
      } else if (provider === 'claude-code') await claudeAuth.disconnect();
      else await unlink(`${stateDir}/credential.json`).catch(() => {});
      return { state: 'disconnected' };
    }
    case 'start': {
      checkId(input.id);
      if (
        typeof input.prompt !== 'string' ||
        input.prompt.length > 100000 ||
        typeof input.model !== 'string' ||
        typeof input.instructions !== 'string'
      )
        throw new Error('invalid_request');
      const key = hash({
        prompt: input.prompt,
        model: input.model,
        instructions: input.instructions,
      });
      const existing = ledger.get(input.id);
      if (existing) {
        if (existing.hash && existing.hash !== key) throw new Error('idempotency_conflict');
        return existing;
      }
      if (active || (provider === 'claude-code' && claudeAuth.session)) return { state: 'busy' };
      const run = { id: input.id, hash: key, state: 'running', text: null };
      active = { id: input.id, cancelRequested: false };
      ledger.set(input.id, run);
      await persist(run); // A process crash can never cause a blind second inference.
      void execute(run, input);
      return run;
    }
    case 'run':
      checkId(input.id);
      return ledger.get(input.id) ?? { state: 'missing' };
    case 'cancel': {
      checkId(input.id);
      if (active?.id === input.id) {
        const current = active;
        current.cancelRequested = true;
        await current.cancel?.();
        current.kill?.();
        return { state: 'cancelling' };
      }
      let run = ledger.get(input.id);
      if (!run) {
        run = { id: input.id, state: 'cancelled' };
        ledger.set(input.id, run);
        await persist(run);
      }
      return run;
    }
    default:
      throw new Error('unknown_action');
  }
}
// All lifecycle mutations are serialized; inference runs outside this short queue.
let queue = Promise.resolve();
http
  .createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    try {
      if (req.method !== 'POST' || req.url !== '/request') throw new Error('invalid_request');
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 150000) throw new Error('body_limit');
      }
      const task = queue.then(() => dispatch(JSON.parse(body)));
      queue = task.catch(() => {});
      res.end(JSON.stringify(await task));
    } catch (error) {
      res.statusCode = 400;
      const allowed = [
        'runtime_tls_error',
        'runtime_network_error',
        'runtime_provider_refused',
        'auth_failed',
        'auth_session_expired',
        'invalid_auth_code',
        'auth_code_submitted',
        'account_busy',
      ];
      res.end(
        JSON.stringify({
          error_code: allowed.includes(error?.message) ? error.message : 'runtime_unavailable',
        }),
      );
    }
  })
  .listen(7090, '127.0.0.1');
