import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { stripVTControlCharacters } from 'node:util';

export function claudeEnvironment() {
  return {
    PATH: process.env.PATH,
    HOME: '/home/node',
    LANG: 'C.UTF-8',
    SSL_CERT_FILE: '/etc/ssl/certs/ca-certificates.crt',
    CLAUDE_CONFIG_DIR: '/home/node/.claude',
    DISABLE_AUTOUPDATER: '1',
  };
}

export function subscriptionUrl(raw) {
  try {
    const url = new URL(raw);
    return ['https://claude.ai', 'https://claude.com'].includes(url.origin) &&
      ['/oauth/authorize', '/cai/oauth/authorize'].includes(url.pathname) &&
      !url.username &&
      !url.password &&
      url.searchParams.has('state') &&
      url.searchParams.has('code_challenge')
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export class ClaudeAuth {
  constructor({
    readCredentials,
    saveCredentials,
    clearCredentials,
    command = 'claude',
    env = claudeEnvironment(),
    cwd = '/workspace',
    lifetime = 10 * 60000,
    commandTimeout = 15000,
  }) {
    Object.assign(this, {
      readCredentials,
      saveCredentials,
      clearCredentials,
      command,
      env,
      cwd,
      lifetime,
      commandTimeout,
    });
    this.session = null;
    this.failure = null;
  }
  child(args) {
    // Deliberately exclude host credentials and API keys from subscription processes.
    const env = { ...this.env };
    for (const key of Object.keys(env)) {
      if (/^(ANTHROPIC_|CLAUDE_CODE_OAUTH_TOKEN|CLAUDE_CODE_USE_)/.test(key)) delete env[key];
    }
    return spawn(this.command, args, {
      cwd: this.cwd,
      env,
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  }
  kill(child) {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }
  async invoke(args) {
    const child = this.child(args);
    let output = '';
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.kill(child);
        reject(new Error('runtime_network_error'));
      }, this.commandTimeout);
      child.stdin.end();
      child.stderr.resume();
      child.stdout.on('data', (chunk) => {
        output += chunk;
        if (output.length > 64000) {
          this.kill(child);
          reject(new Error('runtime_provider_refused'));
        }
      });
      child.on('error', () => {
        clearTimeout(timer);
        reject(new Error('runtime_unavailable'));
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ code, output });
      });
    });
  }
  async nativeStatus() {
    const result = await this.invoke(['auth', 'status']);
    try {
      const data = JSON.parse(result.output);
      return result.code === 0 && data.loggedIn === true && data.authMethod === 'claude.ai';
    } catch {
      throw new Error('runtime_provider_refused');
    }
  }
  publicLogin() {
    if (!this.session?.url) return null;
    return {
      kind: 'claude_subscription',
      loginId: this.session.id,
      verificationUrl: this.session.url,
      expires_at: this.session.expiresAt,
    };
  }
  stop(reason = null) {
    const session = this.session;
    this.session = null;
    this.failure = reason;
    if (session) {
      clearTimeout(session.timer);
      this.kill(session.child);
    }
  }
  async begin() {
    if (this.session) return { state: 'connecting', login: this.publicLogin() };
    this.failure = null;
    // Switching mode invalidates the former API credential before starting OAuth.
    await this.clearCredentials();
    const logout = await this.invoke(['auth', 'logout']);
    if (logout.code !== 0) throw new Error('runtime_provider_refused');
    const child = this.child(['auth', 'login', '--claudeai']);
    const session = {
      id: randomUUID(),
      child,
      url: null,
      exited: false,
      code: null,
      submitted: false,
      expiresAt: new Date(Date.now() + this.lifetime).toISOString(),
    };
    this.session = session;
    session.finished = new Promise((resolve) => {
      child.on('error', () => {
        session.exited = true;
        session.code = -1;
        resolve();
      });
      child.on('close', (code) => {
        session.exited = true;
        session.code = code;
        resolve();
      });
    });
    // Never persist or log OAuth URLs, browser codes, stdout or stderr.
    child.stdin.on('error', () => {});
    let output = '';
    const capture = (chunk) => {
      output += stripVTControlCharacters(String(chunk));
      if (output.length > 64000) {
        this.stop('auth_failed');
        return;
      }
      for (const match of output.matchAll(/https:\/\/[^\s]+(?=\s)/g)) {
        const url = subscriptionUrl(match[0]);
        if (url) session.url = url;
      }
    };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    session.timer = setTimeout(() => {
      if (this.session === session) this.stop('auth_expired');
    }, this.lifetime);
    const deadline = Date.now() + this.commandTimeout;
    while (this.session === session && !session.url && !session.exited && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 50));
    if (!session.url || this.session !== session || session.exited) {
      this.stop('auth_failed');
      throw new Error('auth_failed');
    }
    return { state: 'connecting', login: this.publicLogin() };
  }
  async complete(id, code) {
    const session = this.session;
    if (!session || id !== session.id) throw new Error('auth_session_expired');
    if (Date.now() >= Date.parse(session.expiresAt)) {
      this.stop('auth_expired');
      throw new Error('auth_session_expired');
    }
    if (
      typeof code !== 'string' ||
      !/^[a-zA-Z0-9._~+/=-]+(?:#[a-zA-Z0-9._~+/=-]+)?$/.test(code) ||
      code.length < 10 ||
      code.length > 4096
    )
      throw new Error('invalid_auth_code');
    if (session.submitted) throw new Error('auth_code_submitted');
    if (session.exited) return this.status();
    session.submitted = true;
    session.child.stdin.write(code + '\n');
    // Return control promptly even if the provider is slow. Status can complete later.
    let timer;
    await Promise.race([
      session.finished,
      new Promise((resolve) => {
        timer = setTimeout(resolve, this.commandTimeout);
      }),
    ]);
    clearTimeout(timer);
    return this.status();
  }
  async status() {
    const session = this.session;
    if (session?.exited) {
      clearTimeout(session.timer);
      this.session = null;
      if (session.code === 0 && (await this.nativeStatus())) {
        await this.saveCredentials({ method: 'claude_subscription' });
        this.failure = null;
      } else this.failure = 'auth_failed';
    }
    if (this.session) return { state: 'connecting', auth_method: null, login: this.publicLogin() };
    const auth = await this.readCredentials();
    if (auth?.method === 'claude_subscription') {
      const ready = await this.nativeStatus();
      return {
        state: ready ? 'ready' : 'disconnected',
        auth_method: ready ? 'claude_subscription' : null,
        login: null,
        error_code: ready ? null : 'auth_expired',
      };
    }
    return {
      state: auth?.secret ? 'ready' : 'disconnected',
      auth_method: auth?.secret ? 'api_key' : null,
      login: null,
      error_code: this.failure,
    };
  }
  async disconnect() {
    this.stop();
    await this.clearCredentials();
    const result = await this.invoke(['auth', 'logout']);
    if (result.code !== 0) throw new Error('runtime_provider_refused');
  }
}
