#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { createInterface } from 'node:readline';
const file = process.env.FIXTURE_STATE;
if (
  process.env.ANTHROPIC_API_KEY ||
  process.env.ANTHROPIC_AUTH_TOKEN ||
  process.env.CLAUDE_CODE_OAUTH_TOKEN
)
  process.exit(9);
if (process.argv[3] === 'logout') {
  if (existsSync(file)) unlinkSync(file);
  process.exit(0);
}
if (process.argv[3] === 'status') {
  console.log(
    JSON.stringify(
      existsSync(file) ? JSON.parse(readFileSync(file)) : { loggedIn: false, authMethod: 'none' },
    ),
  );
  process.exit(existsSync(file) ? 0 : 1);
}
if (process.argv[3] !== 'login' || !process.argv.includes('--claudeai')) process.exit(8);
console.log(
  'If the browser did not open: https://claude.com/cai/oauth/authorize?state=fixture-state&code_challenge=fixture-challenge',
);
console.log('Paste code here if prompted >');
createInterface({ input: process.stdin }).on('line', (code) => {
  if (code !== 'fixture-code#fixture-state') {
    console.error('private-code:' + code);
    process.exit(1);
  }
  writeFileSync(
    file,
    JSON.stringify({
      loggedIn: true,
      authMethod: process.env.FIXTURE_MODE === 'api' ? 'api_key' : 'claude.ai',
      email: 'private@example.invalid',
    }),
  );
  process.exit(0);
});
