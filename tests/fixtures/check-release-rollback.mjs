// Real Docker rehearsal on synthetic data, never on the live Jarvis stack.
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import net from 'node:net';
import { Docker, AppDeployer } from '../../apps/release-controller/docker.mjs';
const docker = new Docker();
const project = 'jarvis-roll-fixture-' + randomBytes(3).toString('hex');
const baseImage = (await docker.call('GET', '/images/jarvis_app:latest/json')).Id;
const badImage = (await docker.call('GET', '/images/node:24-bullseye-slim/json')).Id;
const labels = {
  'com.docker.compose.project': project,
  'com.docker.compose.service': 'app',
  'org.opencontainers.image.revision': 'a'.repeat(40),
};
const server = net.createServer();
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
await new Promise((r) => server.close(r));
let candidateImage;
const deployer = new AppDeployer(docker, project);
try {
  await docker.call('POST', '/networks/create', {
    Name: project,
    Internal: true,
    Labels: { 'jarvis.fixture': project },
  });
  const db = await docker.call('POST', `/containers/create?name=${project}-db`, {
    Image: 'postgres:16-alpine',
    Env: ['POSTGRES_USER=jarvis', 'POSTGRES_DB=jarvis', 'POSTGRES_PASSWORD=fixture-only'],
    Labels: { 'jarvis.fixture': project },
    HostConfig: {
      NetworkMode: project,
      Tmpfs: { '/var/lib/postgresql/data': 'rw,nosuid,size=384m' },
    },
    NetworkingConfig: { EndpointsConfig: { [project]: {} } },
  });
  await docker.call('POST', `/containers/${db.Id}/start`);
  await new Promise((r) => setTimeout(r, 2500));
  const app = await docker.call('POST', `/containers/create?name=${project}-app`, {
    Image: baseImage,
    Labels: { ...labels, 'jarvis.fixture': project },
    Env: [
      `DATABASE_URL=postgresql://jarvis:fixture-only@${project}-db:5432/jarvis`,
      'JARVIS_OWNER_PASSWORD=fixture-password-for-tests-only',
      'APP_ORIGIN=http://localhost:3000',
      'HARNESS_MODE=mock',
      'HOST=0.0.0.0',
      'PORT=3000',
    ],
    HostConfig: {
      ReadonlyRootfs: true,
      NetworkMode: project,
      Tmpfs: { '/tmp': 'rw,size=256m' },
      PortBindings: { '3000/tcp': [{ HostIp: '127.0.0.1', HostPort: String(port) }] },
      CapDrop: ['ALL'],
      SecurityOpt: ['no-new-privileges:true'],
    },
    NetworkingConfig: { EndpointsConfig: { [project]: { Aliases: ['app'] } } },
  });
  await docker.call('POST', `/containers/${app.Id}/start`);
  await deployer.waitHealthy(app.Id);
  const original = await deployer.capture();
  assert.equal(original.previous_container, app.Id);
  // Different image identity with identical application code; synthetic credentials only.
  candidateImage = (
    await docker.call('POST', `/commit?container=${app.Id}&pause=false`, {
      Labels: { ...labels, 'fixture.candidate': 'true' },
    })
  ).Id;
  const job = {
    id: randomUUID(),
    payload: { commit: 'b'.repeat(40) },
    artifact: { ...original, image: candidateImage },
  };
  const realCall = docker.call.bind(docker);
  let interrupted = false;
  docker.call = async (method, route, body) => {
    if (!interrupted && route.startsWith('/containers/create')) {
      interrupted = true;
      throw new Error('release_lock_lost');
    }
    return realCall(method, route, body);
  };
  await assert.rejects(deployer.promote(job), /release_lock_lost/);
  docker.call = realCall;
  await new AppDeployer(docker, project).promote(job);
  await deployer.healthy(job);
  const promoted = await docker.inspect(original.name);
  assert.equal(promoted.Image, candidateImage);
  assert.equal(promoted.HostConfig.PortBindings['3000/tcp'][0].HostPort, String(port));
  assert.equal((await docker.inspect(app.Id)).State.Running, false);
  await deployer.promote(job);
  assert.equal(
    (await docker.inspect(original.name)).Id,
    promoted.Id,
    'resume does not create another app',
  );
  await deployer.rollback(job);
  assert.equal((await docker.inspect(original.name)).Id, app.Id);
  await deployer.rollback(job);
  // A broken image really stops the app; restoration brings back the very same container.
  const broken = { ...job, id: randomUUID(), artifact: { ...original, image: badImage } };
  await assert.rejects(deployer.promote(broken));
  await deployer.rollback(broken);
  assert.equal((await docker.inspect(original.name)).Id, app.Id);
  await deployer.probe(await docker.inspect(app.Id));
  console.log(
    'PASS Docker: approved image switch, fixed port preserved, resume after stop/rename interruption, no duplicate app, manual rollback, broken image rollback and original container restored.',
  );
} finally {
  const all = await docker.call(
    'GET',
    `/containers/json?all=true&filters=${encodeURIComponent(JSON.stringify({ label: [`jarvis.fixture=${project}`] }))}`,
  );
  for (const c of all)
    await docker.call('DELETE', `/containers/${c.Id}?force=true&v=true`).catch(() => {});
  await docker.call('DELETE', `/networks/${project}`).catch(() => {});
  await docker.call('DELETE', `/images/${project}_app:latest`).catch(() => {});
  if (candidateImage) await docker.call('DELETE', `/images/${candidateImage}`).catch(() => {});
}
