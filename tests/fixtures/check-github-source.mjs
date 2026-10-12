// No GitHub account required. Tests the real Docker boundary used by remote snapshots.
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { developmentRunner } from '../../apps/runner-supervisor/development.mjs';
const exec = promisify(execFile);
const prefix = `jarvis-gh-fixture-${randomUUID().slice(0, 8)}`;
const image = process.env.GITHUB_SOURCE_FIXTURE_IMAGE ?? 'jarvis-development:current';
process.env.JARVIS_DEVELOPMENT_IMAGE = image;
const docker = async (args) => (await exec('docker', args, { maxBuffer: 3000000 })).stdout.trim();
const runner = developmentRunner(docker, prefix);
const state = await runner({ action: 'development_status' });
assert.equal(state.available, true);
const workspace_id = randomUUID();
const volume = `${prefix}-github-sources`;
const operation = (tool) => ({
  action: 'development_operation',
  id: randomUUID(),
  workspace_id,
  image_digest: state.image_digest,
  operation: tool,
});
async function finish(input) {
  for (let i = 0; i < 800; i++) {
    const r = await runner(input);
    if (['succeeded', 'failed'].includes(r.state)) return r;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('Fixture timed out');
}
try {
  await docker(['volume', 'create', volume]);
  const code = `const fs=require('node:fs/promises');const path=require('node:path');const base='/sources/${workspace_id}/repo';const excluded=new Set(['.git','node_modules','dist','test-results','playwright-report']);await fs.mkdir(base,{recursive:true});await fs.cp('/opt/reference',base,{recursive:true,filter:(source)=>!source.split('/').some(p=>excluded.has(p)||p==='.env'||p.startsWith('.env.'))});await fs.writeFile(base+'/source-marker.txt','Present in remote source, absent from built-in reference');async function readonly(dir){for(const e of await fs.readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())await readonly(p);else {const st=await fs.stat(p);await fs.chmod(p,st.mode&0o111?0o555:0o444);}}}await readonly(base);`;
  await new Promise((resolve, reject) => {
    const p = spawn(
      'docker',
      [
        'run',
        '--rm',
        '-i',
        '--network',
        'none',
        '--user',
        '0:0',
        '--entrypoint',
        'node',
        '--mount',
        `type=volume,source=${volume},target=/sources`,
        image,
        '--input-type=module',
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let error = '';
    p.stderr.on('data', (b) => (error += b));
    p.stdout.resume();
    p.on('close', (c) => (c === 0 ? resolve() : reject(new Error(error))));
    p.stdin.end(
      code.replace(
        "const fs=require('node:fs/promises');const path=require('node:path');",
        "import * as fs from 'node:fs/promises';import path from 'node:path';",
      ),
    );
  });
  const initialize = operation({ tool: 'initialize', source_id: workspace_id });
  let r = await finish(initialize);
  assert.equal(r.state, 'succeeded', JSON.stringify(r));
  assert.ok(r.result.files.includes('source-marker.txt'));
  const container = JSON.parse(await docker(['inspect', `${prefix}-dev-${initialize.id}`]))[0];
  assert.equal(container.HostConfig.NetworkMode, 'none');
  assert.equal(container.Mounts.find((m) => m.Name === volume).RW, false);
  assert.ok(container.Mounts.every((m) => !m.Name?.includes('github-state')));
  r = await finish(
    operation({
      tool: 'exec',
      command:
        'test -z "$GH_TOKEN" && test -z "$GITHUB_TOKEN" && test ! -e /state/auth && test ! -e /var/run/docker.sock',
    }),
  );
  assert.equal(r.result.exit_code, 0);
  r = await finish(
    operation({ tool: 'write', path: 'README.md', content: 'GitHub snapshot fixture\n' }),
  );
  assert.equal(r.state, 'succeeded', JSON.stringify(r));
  r = await finish(operation({ tool: 'freeze', source_id: workspace_id }));
  assert.equal(r.state, 'succeeded', JSON.stringify(r));
  assert.deepEqual(r.result.files, ['README.md']);
  assert.ok(!r.result.patch.includes('source-marker.txt'));
  r = await finish(operation({ tool: 'validate' }));
  assert.equal(r.state, 'succeeded', JSON.stringify(r));
  assert.equal(r.result.passed, true, r.result.output);
  console.log(
    'PASS Docker: immutable remote source, writable isolated copy, patch relative to exact source, baseline checks including .mjs, no credentials/network/socket.',
  );
} finally {
  const ids = (await docker(['ps', '-aq', '--filter', `label=jarvis.owner=${prefix}`]))
    .split('\n')
    .filter(Boolean);
  if (ids.length) await docker(['rm', '-f', ...ids]);
  for (const name of [
    volume,
    `${prefix}-workspace-${workspace_id}`,
    `${prefix}-artifact-${workspace_id}`,
  ])
    await docker(['volume', 'rm', name]).catch(() => {});
}
