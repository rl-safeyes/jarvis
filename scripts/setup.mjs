import { randomBytes } from 'node:crypto';
import { writeFileSync, readFileSync, existsSync, appendFileSync, chmodSync } from 'node:fs';
const additions = {
  JARVIS_VAULT_KEY: randomBytes(32).toString('hex'),
  JARVIS_SUPERVISOR_TOKEN: randomBytes(32).toString('hex'),
  JARVIS_INITIAL_HARNESSES: 'codex',
};
if (existsSync('.env')) {
  const content = readFileSync('.env', 'utf8');
  const missing = Object.entries(additions).filter(
    ([key]) => !new RegExp(`^${key}=.+$`, 'm').test(content),
  );
  if (missing.length)
    appendFileSync('.env', '\n' + missing.map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
  chmodSync('.env', 0o600);
  console.log(
    'Configuration conservée ; paramètres manquants du superviseur ajoutés. Aucun mot de passe existant modifié.',
  );
} else {
  const dbPassword = randomBytes(24).toString('hex');
  const ownerPassword = randomBytes(24).toString('base64url');
  writeFileSync(
    '.env',
    `DATABASE_URL=postgresql://jarvis:${dbPassword}@127.0.0.1:55432/jarvis\nPOSTGRES_PASSWORD=${dbPassword}\nJARVIS_OWNER_PASSWORD=${ownerPassword}\nAPP_ORIGIN=http://localhost:5173\nHOST=127.0.0.1\nPORT=3000\nHARNESS_MODE=live\n${Object.entries(
      additions,
    )
      .map(([k, v]) => `${k}=${v}`)
      .join('\n')}\n`,
    { flag: 'wx', mode: 0o600 },
  );
  console.log(
    'Configuration créée dans .env (0600). Le mot de passe est la valeur JARVIS_OWNER_PASSWORD dans ce fichier.',
  );
}
