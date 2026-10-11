#!/usr/bin/env node
// Test protocol peer. Never calls a model or a provider endpoint.
import { createInterface } from 'node:readline';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
const path = '/home/node/jarvis/fixture-auth';
const send = (x) => process.stdout.write(JSON.stringify(x) + '\n');
let timer;
if (process.argv.includes('--version')) {
  console.log('codex fixture');
  process.exit(0);
}
createInterface({ input: process.stdin }).on('line', (line) => {
  const r = JSON.parse(line),
    p = r.params ?? {};
  if (r.id === undefined) return;
  const result = (value) => send({ id: r.id, result: value });
  switch (r.method) {
    case 'initialize':
      return result({});
    case 'account/read':
      return result({ account: existsSync(path) ? { type: 'chatgpt' } : null });
    case 'account/login/start':
      writeFileSync(path, 'fixture');
      return result({ type: 'apiKey' });
    case 'account/logout':
      if (existsSync(path)) unlinkSync(path);
      return result({});
    case 'model/list':
      return result({ data: [{ model: 'fixture-model', displayName: 'Test uniquement' }] });
    case 'thread/start':
      return result({ thread: { id: 'fixture-thread' } });
    case 'turn/start': {
      writeFileSync(
        '/home/node/jarvis/fixture-starts',
        String(
          Number(
            existsSync('/home/node/jarvis/fixture-starts')
              ? readFileSync('/home/node/jarvis/fixture-starts', 'utf8')
              : 0,
          ) + 1,
        ),
      );
      result({ turn: { id: 'fixture-turn' } });
      const slow = p.input[0].text.includes('attends');
      timer = setTimeout(
        () => {
          send({
            method: 'item/completed',
            params: {
              threadId: 'fixture-thread',
              item: {
                type: 'agentMessage',
                id: 'answer',
                text: 'Réponse du pair de test, sans modèle externe.',
              },
            },
          });
          send({
            method: 'turn/completed',
            params: { threadId: 'fixture-thread', turn: { status: 'completed' } },
          });
        },
        slow ? 15000 : 200,
      );
      return;
    }
    case 'turn/interrupt':
      clearTimeout(timer);
      result({});
      return send({
        method: 'turn/completed',
        params: { threadId: 'fixture-thread', turn: { status: 'interrupted' } },
      });
    default:
      return send({ id: r.id, error: { code: -32601, message: 'unsupported' } });
  }
});
