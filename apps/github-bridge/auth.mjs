import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
export class GitHubAuth {
  constructor(directory, command = 'gh') {
    this.directory = directory;
    this.command = command;
    this.login = null;
    this.generation = 0;
    this.error = null;
    this.queue = Promise.resolve();
  }
  env() {
    return {
      PATH: process.env.PATH,
      HOME: this.directory,
      GH_CONFIG_DIR: this.directory,
      GH_HOST: 'github.com',
      GH_BROWSER: '/bin/true',
      GH_PROMPT_DISABLED: '1',
      NO_COLOR: '1',
      TERM: 'dumb',
      LANG: 'C.UTF-8',
    };
  }
  async run(args) {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    return new Promise((resolve, reject) => {
      const p = spawn(this.command, args, { env: this.env(), stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      const timer = setTimeout(() => p.kill('SIGKILL'), 15000);
      p.stdout.on('data', (b) => {
        out += b;
        if (out.length > 65536) p.kill('SIGKILL');
      });
      p.stderr.resume();
      p.once('error', () => {
        clearTimeout(timer);
        reject(new Error('github_disconnected'));
      });
      p.once('close', (code) => {
        clearTimeout(timer);
        code === 0 ? resolve(out.trim()) : reject(new Error('github_disconnected'));
      });
    });
  }
  async token() {
    const token = await this.run(['auth', 'token', '--hostname', 'github.com']);
    if (!token || /\s/.test(token)) throw new Error('github_disconnected');
    return token;
  }
  async account() {
    const token = await this.token();
    const r = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Jarvis',
      },
      signal: AbortSignal.timeout(15000),
      redirect: 'error',
    });
    if (!r.ok) throw new Error(r.status === 401 ? 'github_disconnected' : 'github_unavailable');
    const data = await r.json();
    if (typeof data.login !== 'string') throw new Error('github_unavailable');
    return data.login;
  }
  async status() {
    if (this.login)
      return {
        state: 'connecting',
        login: {
          id: this.login.id,
          code: this.login.code,
          verification_url: 'https://github.com/login/device',
          expires_at: this.login.expires_at,
        },
        error: this.error,
      };
    try {
      return { state: 'connected', account: await this.account(), error: null };
    } catch {
      return { state: 'disconnected', error: this.error };
    }
  }
  cancel() {
    const login = this.login;
    this.login = null;
    if (login) {
      clearTimeout(login.timer);
      login.process.kill('SIGKILL');
    }
  }
  disconnect() {
    const task = this.queue.then(() => this.disconnectNow());
    this.queue = task.catch(() => {});
    return task;
  }
  async disconnectNow() {
    this.generation++;
    this.cancel();
    await this.run(['auth', 'logout', '--hostname', 'github.com']).catch(() => {});
    await fs.rm(this.directory, { recursive: true, force: true });
    this.error = null;
    return { state: 'disconnected' };
  }
  connect() {
    const task = this.queue.then(() => this.connectNow());
    this.queue = task.catch(() => {});
    return task;
  }
  async connectNow() {
    if (this.login) return this.status();
    // Existing account stays connected until the owner explicitly disconnects it.
    const status = await this.status();
    if (status.state === 'connected') return status;
    this.generation++;
    this.error = null;
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    const p = spawn(
      this.command,
      [
        'auth',
        'login',
        '--hostname',
        'github.com',
        '--git-protocol',
        'https',
        '--web',
        '--skip-ssh-key',
      ],
      { env: this.env(), stdio: ['pipe', 'pipe', 'pipe'] },
    );
    const login = {
      id: randomUUID(),
      process: p,
      code: null,
      expires_at: new Date(Date.now() + 15 * 60000).toISOString(),
    };
    this.login = login;
    let output = '';
    let enter = false;
    login.timer = setTimeout(() => {
      if (this.login === login) {
        this.error = 'github_login_expired';
        this.cancel();
      }
    }, 15 * 60000);
    const capture = (b) => {
      output = (output + b.toString()).replace(/\x1b\[[0-9;]*m/g, '').slice(-16000);
      const match = output.match(/(?:one-time code|code):\s*([A-Z0-9]{4}-[A-Z0-9]{4})/i);
      if (match) login.code = match[1];
      if (!enter && /Press Enter/i.test(output)) {
        enter = true;
        p.stdin.write('\n');
      }
    };
    p.stdout.on('data', capture);
    p.stderr.on('data', capture);
    p.stdin.on('error', () => {});
    p.once('error', () => {
      if (this.login === login) {
        this.error = 'github_login_failed';
        this.cancel();
      }
    });
    p.once('close', (code) => {
      clearTimeout(login.timer);
      if (this.login === login) {
        this.login = null;
        if (code !== 0) this.error = 'github_login_failed';
      }
    });
    return this.status();
  }
}
