import { randomBytes } from 'node:crypto';
import { writeFileSync, existsSync } from 'node:fs';
if (existsSync('.env')) {
  console.log('.env existe déjà ; configuration conservée.');
  process.exit(0);
}
const dbPassword = randomBytes(24).toString('hex');
const ownerPassword = randomBytes(24).toString('base64url');
writeFileSync(
  '.env',
  `DATABASE_URL=postgresql://jarvis:${dbPassword}@127.0.0.1:55432/jarvis\nPOSTGRES_PASSWORD=${dbPassword}\nJARVIS_OWNER_PASSWORD=${ownerPassword}\nAPP_ORIGIN=http://localhost:5173\nHOST=127.0.0.1\nPORT=3000\nHARNESS_MODE=mock\n`,
  { flag: 'wx', mode: 0o600 },
);
console.log(
  'Configuration créée dans .env (permissions 0600). Le mot de passe de connexion est la valeur JARVIS_OWNER_PASSWORD dans ce fichier.',
);
