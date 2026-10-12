#!/usr/bin/env node
process.stdout.write(
  /username/i.test(process.argv[2] ?? '')
    ? 'x-access-token\n'
    : `${process.env.JARVIS_GITHUB_TOKEN ?? ''}\n`,
);
