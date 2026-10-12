import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const version = '2.83.2';
const arch = { x64: 'amd64', arm64: 'arm64' }[process.arch];
if (!arch) throw new Error('Unsupported GitHub CLI architecture');
const name = `gh_${version}_linux_${arch}.tar.gz`;
const base = `https://github.com/cli/cli/releases/download/v${version}/`;
const manifest = await fetch(base + `gh_${version}_checksums.txt`);
if (!manifest.ok) throw new Error('GitHub CLI checksums unavailable');
const expected = (await manifest.text())
  .split('\n')
  .find((l) => l.trim().endsWith(name))
  ?.split(/\s+/)[0];
if (!expected || !/^[a-f0-9]{64}$/.test(expected)) throw new Error('GitHub CLI checksum absent');
const response = await fetch(base + name);
if (!response.ok) throw new Error('GitHub CLI download failed');
const data = Buffer.from(await response.arrayBuffer());
if (createHash('sha256').update(data).digest('hex') !== expected)
  throw new Error('GitHub CLI checksum mismatch');
await writeFile('/tmp/gh.tar.gz', data);
execFileSync('tar', ['-xzf', '/tmp/gh.tar.gz', '-C', '/tmp', `gh_${version}_linux_${arch}/bin/gh`]);
execFileSync('install', [
  '-m',
  '755',
  `/tmp/gh_${version}_linux_${arch}/bin/gh`,
  '/usr/local/bin/gh',
]);
