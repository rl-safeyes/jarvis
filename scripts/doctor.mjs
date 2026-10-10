import { spawnSync } from 'node:child_process';
console.log(`Node.js : ${process.version}`);
for (const command of ['git', 'docker', 'codex', 'claude', 'opencode']) {
  const result = spawnSync(command, ['--version'], { encoding: 'utf8', timeout: 10000 });
  console.log(
    `${command} : ${result.status === 0 ? result.stdout.trim().split('\n')[0] : 'indisponible'}`,
  );
}
console.log(
  'Diagnostic de présence uniquement. Aucun compte, secret ou accès modèle n’est vérifié.',
);
