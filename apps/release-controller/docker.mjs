import http from 'node:http';
import { spawn } from 'node:child_process';
export class Docker {
  constructor(socket = '/var/run/docker.sock') {
    this.socket = socket;
  }
  async call(method, route, body) {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          socketPath: this.socket,
          path: '/v1.41' + route,
          method,
          headers: { 'Content-Type': 'application/json' },
        },
        (res) => {
          let text = '';
          res.on('data', (b) => {
            text += b;
            if (text.length > 3000000) req.destroy();
          });
          res.on('end', () => {
            if (res.statusCode === 404) return resolve(null);
            if (res.statusCode < 200 || res.statusCode >= 300)
              return reject(new Error('release_docker_failed'));
            try {
              resolve(text ? JSON.parse(text) : {});
            } catch {
              reject(new Error('release_docker_failed'));
            }
          });
        },
      );
      req.setTimeout(60000, () => req.destroy());
      req.on('error', () => reject(new Error('release_docker_failed')));
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  }
  inspect(name) {
    return this.call('GET', `/containers/${encodeURIComponent(name)}/json`);
  }
}
export async function command(cmd, args, { cwd, env, input, timeout = 900000 } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, {
      cwd,
      env: env ?? process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
    });
    let output = '';
    let expired = false;
    const timer = setTimeout(() => {
      expired = true;
      try {
        process.kill(-p.pid, 'SIGKILL');
      } catch {}
    }, timeout);
    p.stdout.on('data', (b) => {
      output = (output + b).slice(-100000);
    });
    p.stderr.resume();
    p.on('error', () => {
      clearTimeout(timer);
      reject(new Error('release_command_failed'));
    });
    p.on('close', (c) => {
      clearTimeout(timer);
      c === 0
        ? resolve(output.trim())
        : reject(new Error(expired ? 'release_timeout' : 'release_command_failed'));
    });
    p.stdin.on('error', () => {});
    p.stdin.end(input);
  });
}
export class AppDeployer {
  constructor(docker, project, guard = async () => {}) {
    if (!/^[a-z][a-z0-9-]{0,40}$/.test(project)) throw new Error('release_project_invalid');
    Object.assign(this, { docker, project, guard });
  }
  owned(c) {
    if (
      !c ||
      c.Config.Labels?.['com.docker.compose.project'] !== this.project ||
      c.Config.Labels?.['com.docker.compose.service'] !== 'app'
    )
      throw new Error('release_target_changed');
    return c;
  }
  async capture() {
    const all = await this.docker.call(
      'GET',
      `/containers/json?all=true&filters=${encodeURIComponent(JSON.stringify({ label: [`com.docker.compose.project=${this.project}`, 'com.docker.compose.service=app'] }))}`,
    );
    const running = all.filter((c) => c.State === 'running');
    if (running.length !== 1) throw new Error('release_target_changed');
    const c = this.owned(await this.docker.inspect(running[0].Id));
    const revision = c.Config.Labels['org.opencontainers.image.revision'];
    if (
      !/^[a-f0-9]{40}$/.test(revision ?? '') ||
      c.Mounts?.some((m) => m.Type !== 'tmpfs') ||
      Object.keys(c.NetworkSettings.Networks).length !== 1 ||
      c.HostConfig.AutoRemove ||
      !c.HostConfig.ReadonlyRootfs
    )
      throw new Error('release_enrollment_required');
    return {
      previous_container: c.Id,
      previous_image: c.Image,
      deployed_commit: revision,
      name: c.Name.slice(1),
    };
  }
  async assertTarget(job) {
    const c = this.owned(await this.docker.inspect(job.artifact.name));
    if (
      c.Id !== job.artifact.previous_container ||
      c.Image !== job.artifact.previous_image ||
      !c.State.Running
    )
      throw new Error('release_target_changed');
  }
  async probe(c, full = false) {
    if (!c?.State.Running) throw new Error('release_health_failed');
    const addresses = Object.values(c.NetworkSettings.Networks)
      .map((n) => n.IPAddress)
      .filter(Boolean);
    if (addresses.length !== 1) throw new Error('release_health_failed');
    const base = `http://${addresses[0]}:3000`;
    const req = (p, options = {}) =>
      fetch(base + p, { ...options, signal: AbortSignal.timeout(5000), redirect: 'error' });
    for (const p of ['/healthz', '/'])
      if (!(await req(p)).ok) throw new Error('release_health_failed');
    if (full) {
      const env = Object.fromEntries(
        c.Config.Env.map((e) => {
          const i = e.indexOf('=');
          return [e.slice(0, i), e.slice(i + 1)];
        }),
      );
      const login = await req('/api/v1/auth/login', {
        method: 'POST',
        headers: { origin: env.APP_ORIGIN, 'content-type': 'application/json' },
        body: JSON.stringify({ password: env.JARVIS_OWNER_PASSWORD }),
      });
      if (!login.ok) throw new Error('release_health_failed');
      const data = await login.json();
      const headers = {
        origin: env.APP_ORIGIN,
        cookie: login.headers.get('set-cookie').split(';')[0],
        'x-csrf-token': data.csrf_token,
      };
      try {
        if (!(await req('/api/v1/conversations', { headers })).ok)
          throw new Error('release_health_failed');
      } finally {
        await req('/api/v1/auth/logout', { method: 'POST', headers }).catch(() => {});
      }
    }
  }
  async waitHealthy(id) {
    for (let i = 0; i < 30; i++) {
      await this.guard();
      try {
        await this.probe(await this.docker.inspect(id), true);
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    throw new Error('release_health_failed');
  }
  async promote(job) {
    const a = job.artifact;
    let current = await this.docker.inspect(a.name);
    if (current?.Config.Labels?.['jarvis.release'] === job.id && current.Image === a.image) {
      if (!current.State.Running) {
        await this.guard();
        await this.docker.call('POST', `/containers/${current.Id}/start`);
      }
      await this.waitHealthy(current.Id);
      return;
    }
    const previous = this.owned(await this.docker.inspect(a.previous_container));
    if (previous.Image !== a.previous_image) throw new Error('release_target_changed');
    if (current && current.Id !== previous.Id) throw new Error('release_target_changed');
    await this.guard();
    if (previous.State.Running)
      await this.docker.call('POST', `/containers/${previous.Id}/stop?t=20`);
    const backup = `${this.project}-release-${job.id}-previous`;
    if (previous.Name !== `/${backup}`) {
      await this.guard();
      await this.docker.call('POST', `/containers/${previous.Id}/rename?name=${backup}`);
    }
    const c = previous.Config,
      h = previous.HostConfig;
    const config = {
      Image: a.image,
      Env: c.Env,
      Cmd: c.Cmd,
      Entrypoint: c.Entrypoint,
      User: c.User,
      WorkingDir: c.WorkingDir,
      ExposedPorts: c.ExposedPorts,
      Healthcheck: c.Healthcheck,
      Labels: {
        ...c.Labels,
        'jarvis.release': job.id,
        'org.opencontainers.image.revision': job.payload.commit,
      },
      HostConfig: {
        ReadonlyRootfs: true,
        Init: h.Init,
        CapDrop: h.CapDrop,
        SecurityOpt: h.SecurityOpt,
        Tmpfs: h.Tmpfs,
        PortBindings: h.PortBindings,
        RestartPolicy: h.RestartPolicy,
        Memory: h.Memory,
        PidsLimit: h.PidsLimit,
        NetworkMode: h.NetworkMode,
      },
      NetworkingConfig: {
        EndpointsConfig: Object.fromEntries(
          Object.keys(previous.NetworkSettings.Networks).map((n) => [
            n,
            { Aliases: ['app', a.name] },
          ]),
        ),
      },
    };
    await this.guard();
    const created = await this.docker.call(
      'POST',
      `/containers/create?name=${encodeURIComponent(a.name)}`,
      config,
    );
    await this.guard();
    await this.docker.call('POST', `/containers/${created.Id}/start`);
    await this.waitHealthy(created.Id);
    await this.guard();
    await this.docker.call('POST', `/images/${a.image}/tag?repo=${this.project}_app&tag=latest`);
  }
  async healthy(job) {
    const c = this.owned(await this.docker.inspect(job.artifact.name));
    if (c.Image !== job.artifact.image || c.Config.Labels['jarvis.release'] !== job.id)
      throw new Error('release_target_changed');
    await this.probe(c);
  }
  async rollback(job) {
    const a = job.artifact,
      previous = this.owned(await this.docker.inspect(a.previous_container));
    if (previous.Image !== a.previous_image) throw new Error('release_target_changed');
    const current = await this.docker.inspect(a.name);
    if (current && current.Id !== previous.Id) {
      if (current.Image !== a.image || current.Config.Labels?.['jarvis.release'] !== job.id)
        throw new Error('release_target_changed');
      await this.guard();
      if (current.State.Running)
        await this.docker.call('POST', `/containers/${current.Id}/stop?t=10`);
      await this.guard();
      await this.docker.call(
        'POST',
        `/containers/${current.Id}/rename?name=${this.project}-release-${job.id}-rejected`,
      );
    }
    if (previous.Name !== `/${a.name}`) {
      await this.guard();
      await this.docker.call(
        'POST',
        `/containers/${previous.Id}/rename?name=${encodeURIComponent(a.name)}`,
      );
    }
    if (!previous.State.Running) {
      await this.guard();
      await this.docker.call('POST', `/containers/${previous.Id}/start`);
    }
    await this.waitHealthy(previous.Id);
    await this.guard();
    await this.docker.call(
      'POST',
      `/images/${a.previous_image}/tag?repo=${this.project}_app&tag=latest`,
    );
  }
}
