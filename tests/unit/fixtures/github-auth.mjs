#!/usr/bin/env node
if (process.argv.includes('login')) {
  process.stderr.write(
    '! First copy your one-time code: ABCD-1234\nPress Enter to open github.com in your browser...',
  );
  process.stdin.once('data', () => {});
  setInterval(() => {}, 1000);
} else process.exit(1);
