// Run only on an isolated CI runner or by an operator. No production configuration is read.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
const image = process.argv[2];
if (!image || !/^sha256:[a-f0-9]{64}$/.test(image))
  throw new Error('Immutable Docker image ID required');
const stableId = process.env.JARVIS_PREPROD_ID;
if (stableId && !/^[a-f0-9-]{36}$/.test(stableId)) throw new Error('Invalid fixture id');
const prefix = 'jarvis-preprod-' + (stableId ?? randomBytes(6).toString('hex'));
const password = randomBytes(32).toString('hex');
const origin = `http://${prefix}-app:3000`;
async function docker(args, input) {
  return new Promise((resolve, reject) => {
    const p = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    const timer = setTimeout(() => p.kill('SIGKILL'), 180000);
    p.stdout.on('data', (b) => {
      output = (output + b).slice(-50000);
    });
    p.stderr.resume();
    p.on('error', () => {
      clearTimeout(timer);
      reject(new Error('Docker unavailable'));
    });
    p.on('close', (c) => {
      clearTimeout(timer);
      c === 0
        ? resolve(output.trim())
        : reject(new Error('Preproduction Docker command failed: ' + args[0]));
    });
    p.stdin.end(input);
  });
}
const cleanup = async () => {
  for (const name of [`${prefix}-probe`, `${prefix}-app`, `${prefix}-db`])
    await docker(['rm', '-f', '-v', name]).catch(() => {});
  await docker(['network', 'rm', prefix]).catch(() => {});
};
let terminating = false;
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () => {
    if (!terminating) {
      terminating = true;
      void cleanup().finally(() => process.exit(1));
    }
  });
try {
  if (stableId) await cleanup();
  await docker(['network', 'create', '--internal', prefix]);
  await docker([
    'run',
    '-d',
    '--name',
    `${prefix}-db`,
    '--network',
    prefix,
    '--memory',
    '512m',
    '--pids-limit',
    '128',
    '--tmpfs',
    '/var/lib/postgresql/data:rw,nosuid,size=384m',
    '-e',
    'POSTGRES_USER=jarvis',
    '-e',
    'POSTGRES_DB=jarvis',
    '-e',
    `POSTGRES_PASSWORD=${password}`,
    'postgres:16-alpine',
  ]);
  for (let i = 0; ; i++) {
    try {
      await docker(['exec', `${prefix}-db`, 'pg_isready', '-U', 'jarvis', '-d', 'jarvis']);
      break;
    } catch {
      if (i >= 45) throw new Error('Test database unavailable');
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  await docker([
    'run',
    '-d',
    '--name',
    `${prefix}-app`,
    '--network',
    prefix,
    '--read-only',
    '--tmpfs',
    '/tmp:rw,nosuid,size=256m',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges:true',
    '--memory',
    '1g',
    '--pids-limit',
    '128',
    '-e',
    `DATABASE_URL=postgresql://jarvis:${password}@${prefix}-db:5432/jarvis`,
    '-e',
    `JARVIS_OWNER_PASSWORD=${password}`,
    '-e',
    'APP_ORIGIN=http://localhost:3000',
    '-e',
    'HARNESS_MODE=mock',
    image,
  ]);
  const probe = path.resolve('scripts/preproduction-probe.mjs');
  const output = await docker(
    [
      'run',
      '--rm',
      '-i',
      '--name',
      `${prefix}-probe`,
      '--network',
      prefix,
      '--read-only',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges:true',
      '--memory',
      '256m',
      '--pids-limit',
      '32',
      '-e',
      `PROBE_ORIGIN=${origin}`,
      '-e',
      `PROBE_PASSWORD=${password}`,
      '--entrypoint',
      'node',
      image,
      '--input-type=module',
    ],
    await readFile(probe),
  );
  console.log(output);
  const reportDir = process.env.JARVIS_PROBE_REPORT_DIR ?? 'test-results';
  await mkdir(reportDir, { recursive: true });
  await writeFile(
    path.join(reportDir, 'preproduction.json'),
    JSON.stringify(
      {
        image,
        commit: process.env.GITHUB_SHA ?? null,
        passed: true,
        checked_at: new Date().toISOString(),
        checks: [
          'web',
          'migration',
          'session',
          'csrf',
          'conversation',
          'idempotency',
          'simulated_mission',
          'logout',
        ],
      },
      null,
      2,
    ),
  );
} finally {
  await cleanup();
}
