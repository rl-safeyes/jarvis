import type { PoolClient } from 'pg';
import type { HarnessId } from '../../contracts/src/harnesses.ts';
import { HarnessRepository } from './harnesses.ts';
import { DomainError } from './index.ts';
const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[.!?]+$/, '');
const engines: Record<string, HarnessId> = {
  codex: 'codex',
  'claude code': 'claude-code',
  'claude-code': 'claude-code',
  claude: 'claude-code',
  opencode: 'opencode',
  'open code': 'opencode',
};
export type ManagementIntent = {
  action: 'install' | 'connect' | 'default' | 'agent';
  harness?: HarnessId;
  agent?: string;
  inherit?: boolean;
};
/** Deliberately anchored owner commands. Documents/model outputs never call this parser. */
export function managementIntent(text: string): ManagementIntent | null {
  const s = normalize(text).replace(/^jarvis[, ]+/, '');
  let m: RegExpMatchArray | null;
  if (
    (m = s.match(
      /^installe (?:le harness |le moteur )?(.+?)(?: et (?:aide-moi a m'y connecter|connecte mon compte))?$/,
    )) &&
    engines[m[1]!]
  )
    return { action: 'install', harness: engines[m[1]!] };
  if (
    (m = s.match(/^(?:connecte(?:-moi)? (?:a |sur )?|connecte mon compte )(.+)$/)) &&
    engines[m[1]!]
  )
    return { action: 'connect', harness: engines[m[1]!] };
  if ((m = s.match(/^(?:utilise|mets) (.+) par defaut$/)) && engines[m[1]!])
    return { action: 'default', harness: engines[m[1]!] };
  if ((m = s.match(/^(?:travaille|fonctionne) (?:sur|avec) (.+)$/)) && engines[m[1]!])
    return { action: 'agent', agent: 'direction.jarvis', harness: engines[m[1]!] };
  if (
    (m = s.match(
      /^(?:mets |modifie le prompt (?:de |du ))(.+?) (?:sur |pour (?:qu'il utilise |utiliser ))(.+)$/,
    )) &&
    engines[m[2]!]
  )
    return { action: 'agent', agent: m[1]!, harness: engines[m[2]!] };
  if ((m = s.match(/^remets (.+) sur le defaut$/)))
    return { action: 'agent', agent: m[1]!, inherit: true };
  return null;
}
const aliases: Record<string, string> = {
  jarvis: 'direction.jarvis',
  reviewer: 'quality.reviewer',
  developpeur: 'engineering.developer',
  documentaliste: 'knowledge.researcher',
  chercheur: 'knowledge.researcher',
};
export async function manage(
  c: PoolClient,
  repo: HarnessRepository,
  id: string,
  intent: ManagementIntent,
): Promise<string> {
  if (intent.action === 'install') {
    await repo.operation(id, 'install', { harness: intent.harness }, c);
    return `Installation de ${intent.harness} demandée. Suivez son avancement dans Réglages → Harnesses, puis ajoutez ou connectez votre compte. Le défaut reste inchangé.`;
  }
  if (intent.action === 'connect')
    return `Pour connecter ${intent.harness}, ouvrez Réglages, sélectionnez ou ajoutez votre compte, puis lancez la connexion. Le formulaire est réservé au propriétaire ; ne saisissez pas de clé dans cette conversation.`;
  if (intent.action === 'default') await c.query('SELECT * FROM runtime_settings FOR UPDATE');
  let profile: string | null = null;
  if (!intent.inherit) {
    const candidates = (
      await c.query(
        `SELECT p.id FROM execution_profiles p JOIN harness_accounts a ON a.id=p.account_id JOIN harness_installations h ON h.id=a.harness
      WHERE a.harness=$1 AND a.state='ready' AND p.state='ready' AND p.tested_revision=a.revision AND h.state='installed'`,
        [intent.harness],
      )
    ).rows;
    if (candidates.length === 0)
      return `Aucun profil ${intent.harness} prêt. Installez le moteur, connectez le compte puis testez le modèle dans Réglages. Aucun choix n’a été modifié.`;
    if (candidates.length > 1)
      return `Plusieurs profils ${intent.harness} sont disponibles. Choisissez le profil et le compte voulus dans Réglages ; aucun choix n’a été modifié.`;
    profile = candidates[0]!.id;
    await repo.profile(c, profile!, true);
  }
  if (intent.action === 'default') {
    await c.query('UPDATE runtime_settings SET default_profile_id=$1,revision=revision+1', [
      profile,
    ]);
    return `${intent.harness} est désormais le défaut pour les nouveaux runs des agents qui héritent, Jarvis inclus s’il n’a pas de choix spécifique.`;
  }
  const name = (intent.agent ?? '').replace(/^(?:le |la |l')/, '');
  let agentId = aliases[name] ?? name;
  if (!aliases[name] && !name.includes('.')) {
    const matches = (await c.query('SELECT id,name FROM agent_registry')).rows.filter(
      (a) => normalize(a.name) === name,
    );
    if (matches.length > 1)
      throw new DomainError(
        409,
        'agent_ambiguous',
        'Plusieurs agents portent ce nom. Indiquez leur identifiant complet.',
      );
    if (matches.length === 1) agentId = matches[0].id;
  }
  const a = (await c.query('SELECT * FROM agent_configs WHERE id=$1 FOR UPDATE', [agentId]))
    .rows[0];
  if (!a)
    throw new DomainError(
      400,
      'agent_missing',
      'Agent inconnu. Consultez Organisation pour retrouver son nom.',
    );
  await c.query(
    'INSERT INTO agent_config_history(agent_id,revision,instructions,profile_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',
    [a.id, a.revision, a.instructions, a.profile_id],
  );
  await c.query('UPDATE agent_configs SET profile_id=$2,revision=revision+1 WHERE id=$1', [
    a.id,
    profile,
  ]);
  return `La fiche de ${a.id} a une nouvelle version : ${intent.inherit ? 'héritage du défaut' : `profil ${intent.harness}`}. Ses instructions de rôle sont conservées ; le choix du moteur est enregistré dans sa configuration d’exécution.`;
}
