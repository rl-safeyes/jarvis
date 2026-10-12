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
      let answer = 'Réponse du pair de test, sans modèle externe.';
      let slow = p.input[0].text.includes('attends');
      let prompt;
      try {
        prompt = JSON.parse(p.input[0].text);
      } catch {}
      if (prompt?.role === 'development') {
        const tools = prompt.history.map((h) => h.operation.tool);
        answer = JSON.stringify(
          tools.length === 0
            ? {
                type: 'tool',
                operation: {
                  tool: 'exec',
                  command: prompt.task.includes('attends')
                    ? 'sleep 120'
                    : 'git status --short; gh --version; node --version',
                },
              }
            : tools.length === 1
              ? {
                  type: 'tool',
                  operation: {
                    tool: 'write',
                    path: 'docs-development-fixture.txt',
                    content: 'Development fixture: isolated workspace.\n',
                  },
                }
              : { type: 'done', summary: 'Note de recette ajoutée.' },
        );
      } else if (prompt?.role === 'review')
        answer = JSON.stringify({
          verdict: 'approve',
          summary: 'Patch de documentation cohérent avec la demande ; contrôles consultés.',
        });
      else if (prompt?.completed_steps) {
        const request = prompt.conversation.at(-1).content;
        if (request.includes('mission-development')) {
          answer = JSON.stringify(
            prompt.completed_steps.length
              ? {
                  type: 'reply',
                  text: 'Proposition de code préparée, vérifiée et revue. Aucun déploiement.',
                }
              : {
                  type: 'develop',
                  agent_id: 'engineering.developer',
                  reviewer_id: 'quality.reviewer',
                  task: request,
                },
          );
        } else if (request.includes('mission-delegation')) {
          slow = false;
          const agent = prompt.agents.find((a) => a.id === 'produit-recette.analyste-recette');
          const last = prompt.completed_steps.at(-1);
          const action = !agent
            ? {
                type: 'create_agent',
                agent: {
                  name: 'Analyste Recette',
                  department: 'Produit Recette',
                  description: 'Analyste pour la recette de délégation.',
                  instructions: 'Rédige des critères vérifiables en français.',
                  profile_id: null,
                },
              }
            : last?.action === 'delegate'
              ? { type: 'reply', text: 'Synthèse de Jarvis : ' + last.result.text }
              : {
                  type: 'delegate',
                  agent_id: agent.id,
                  task: request.includes('attends')
                    ? 'attends puis rédige les critères'
                    : 'Rédige les critères',
                };
          answer = JSON.stringify(action);
        } else answer = JSON.stringify({ type: 'reply', text: answer });
      } else if (p.input[0].text.includes('critères'))
        answer = 'Résultat du spécialiste : trois critères vérifiables.';
      timer = setTimeout(
        () => {
          send({
            method: 'item/completed',
            params: {
              threadId: 'fixture-thread',
              item: {
                type: 'agentMessage',
                id: 'answer',
                text: answer,
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
