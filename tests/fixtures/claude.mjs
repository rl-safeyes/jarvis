#!/usr/bin/env node
// Protocol fixture: no provider request, real credential or subscription is used.
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { createInterface } from 'node:readline';
const native = '/home/node/fixture-claude-login.json';
if (process.argv[2] === 'auth') {
  if (process.env.ANTHROPIC_API_KEY) process.exit(9);
  if (process.argv[3] === 'logout') {
    if (existsSync(native)) unlinkSync(native);
    process.exit(0);
  }
  if (process.argv[3] === 'status') {
    console.log(
      JSON.stringify({
        loggedIn: existsSync(native),
        authMethod: existsSync(native) ? 'claude.ai' : 'none',
      }),
    );
    process.exit(existsSync(native) ? 0 : 1);
  }
  if (process.argv[3] !== 'login' || !process.argv.includes('--claudeai')) process.exit(8);
  console.log(
    'Open https://claude.com/cai/oauth/authorize?state=fixture-state&code_challenge=fixture-challenge',
  );
  console.log('Paste code here if prompted >');
  createInterface({ input: process.stdin }).on('line', (code) => {
    if (code !== 'fixture-code#fixture-state') process.exit(1);
    writeFileSync(native, 'fixture-only');
    process.exit(0);
  });
} else if (process.argv.includes('-p')) {
  const api = process.env.ANTHROPIC_API_KEY;
  const mode = api ? 'api_key' : 'claude_subscription';
  if (api ? api !== 'fixture-api-only' || existsSync(native) : !existsSync(native)) process.exit(7);
  const settings = process.argv[process.argv.indexOf('--settings') + 1];
  if (!api && JSON.parse(settings).forceLoginMethod !== 'claudeai') process.exit(6);
  let prompt = '';
  for await (const chunk of process.stdin) prompt += chunk;
  writeFileSync('/home/node/fixture-last-mode', mode);
  console.log(
    JSON.stringify({ is_error: prompt.includes('quota-exhausted'), result: `fixture ${mode}` }),
  );
} else process.exit(5);
