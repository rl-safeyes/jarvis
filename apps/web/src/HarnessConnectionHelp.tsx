import { useId, useRef } from 'react';
import { CircleHelp, X } from 'lucide-react';
import type { HarnessId } from '../../../packages/contracts/src/harnesses.ts';

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children} ↗
    </a>
  );
}

function ApiKeySteps({ provider }: { provider: 'OpenAI' | 'Anthropic' }) {
  const anthropic = provider === 'Anthropic';
  return (
    <ol>
      <li>
        Connectez-vous à{' '}
        {anthropic ? (
          <ExternalLink href="https://platform.claude.com/">
            la console Claude / Anthropic
          </ExternalLink>
        ) : (
          <ExternalLink href="https://platform.openai.com/">la plateforme OpenAI</ExternalLink>
        )}
        . Créez un compte si nécessaire et vérifiez que la facturation API est activée avec un
        crédit ou un budget disponible.
      </li>
      <li>
        Ouvrez{' '}
        {anthropic ? (
          <ExternalLink href="https://platform.claude.com/settings/keys">
            Settings → API keys
          </ExternalLink>
        ) : (
          <ExternalLink href="https://platform.openai.com/api-keys">API keys</ExternalLink>
        )}
        , créez une clé pour Jarvis et copiez-la à sa création.
      </li>
      <li>
        Revenez dans Jarvis, sélectionnez votre compte dans « Compte à connecter », collez la clé
        dans « Clé API », puis cliquez sur « Enregistrer la clé » et « Vérifier la connexion ».
      </li>
    </ol>
  );
}

export function HarnessConnectionHelp({ harness, name }: { harness: HarnessId; name: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  return (
    <>
      <button
        type="button"
        className="icon-button harness-help-button"
        aria-label={`Comment connecter ${name} ?`}
        title={`Comment connecter ${name} ?`}
        aria-haspopup="dialog"
        onClick={() => {
          dialog.current?.showModal();
          if (dialog.current) dialog.current.scrollTop = 0;
        }}
      >
        <CircleHelp size={19} aria-hidden="true" />
      </button>
      <dialog
        ref={dialog}
        className="harness-help-dialog"
        aria-labelledby={titleId}
        onKeyDown={(event) => {
          if (event.key !== 'Tab') return;
          const controls = event.currentTarget.querySelectorAll<HTMLElement>('button, a[href]');
          const first = controls[0];
          const last = controls[controls.length - 1];
          const active = event.currentTarget.ownerDocument.activeElement;
          if (event.shiftKey && active === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && active === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
      >
        <header className="harness-help-header">
          <h2 id={titleId}>Connecter {name}</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="Fermer l’aide"
            autoFocus
            onClick={() => dialog.current?.close()}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </header>
        <div className="harness-help-content">
          <section>
            <h3>1. Préparer le compte dans Jarvis</h3>
            <p>
              Dans « Harnesses disponibles », attendez l’état « Installé dans Docker » ; sinon,
              cliquez sur « Installer {name} ».
            </p>
            <p>
              Dans « Connecter un compte », choisissez « {name} », donnez un nom au compte et
              cliquez sur « Ajouter ce compte ». S’il existe déjà, sélectionnez-le dans « Compte à
              connecter ».
            </p>
          </section>
          {harness === 'codex' && (
            <section>
              <h3>2. Choisir une connexion</h3>
              <h4>Avec votre compte ChatGPT</h4>
              <ol>
                <li>
                  Cliquez sur « Se connecter avec ChatGPT », puis sur « Ouvrir la connexion
                  sécurisée ».
                </li>
                <li>
                  Connectez-vous au compte ChatGPT disposant de l’accès Codex et saisissez le code
                  affiché par Jarvis avant son expiration.
                </li>
                <li>Revenez dans Jarvis et cliquez sur « Vérifier la connexion ».</li>
              </ol>
              <p>
                Si OpenAI demande d’activer les codes d’appareil : activez cette option dans les
                paramètres de sécurité ChatGPT ou demandez à l’administrateur de votre espace
                Business / Enterprise de l’activer dans les permissions de l’espace. L’autorisation
                d’utiliser Codex en local ne suffit pas à elle seule.
              </p>
              <p>
                <ExternalLink href="https://developers.openai.com/codex/auth/">
                  Documentation officielle de connexion Codex
                </ExternalLink>
              </p>
              <h4>Ou avec une clé API OpenAI</h4>
              <ApiKeySteps provider="OpenAI" />
              <p>
                Ce mode utilise la facturation API OpenAI, distincte de votre abonnement ChatGPT.
              </p>
            </section>
          )}
          {harness === 'claude-code' && (
            <section>
              <h3>2. Obtenir une clé API Anthropic</h3>
              <p className="harness-help-callout">
                Dans cette version de Jarvis, Claude Code se connecte avec une clé API Anthropic. La
                connexion via un abonnement Claude Pro / Max n’est pas encore intégrée. Les appels
                sont facturés sur votre compte API Anthropic.
              </p>
              <ApiKeySteps provider="Anthropic" />
              <p>
                <ExternalLink href="https://platform.claude.com/docs/en/get-api-key">
                  Guide officiel : créer une clé Anthropic
                </ExternalLink>
              </p>
            </section>
          )}
          {harness === 'opencode' && (
            <section>
              <h3>2. Choisir le fournisseur de modèles</h3>
              <p>
                Jarvis prend actuellement en charge OpenAI API et Anthropic API pour OpenCode. Dans
                le formulaire du compte, choisissez le « Fournisseur » correspondant à votre clé.
              </p>
              <h4>Pour OpenAI API</h4>
              <ApiKeySteps provider="OpenAI" />
              <h4>Pour Anthropic API</h4>
              <ApiKeySteps provider="Anthropic" />
              <p>
                Les appels sont facturés par le fournisseur choisi. Les connexions par abonnement
                ChatGPT ou Claude ne sont pas intégrées au parcours OpenCode de Jarvis.
              </p>
              <p>
                <ExternalLink href="https://opencode.ai/docs/providers/">
                  Documentation officielle des fournisseurs OpenCode
                </ExternalLink>
              </p>
            </section>
          )}
          <section>
            <h3>3. Tester puis choisir le profil</h3>
            <ol>
              <li>
                Dans « Profils et modèle », donnez un nom au profil et choisissez un modèle proposé
                dans le champ « Modèle », ou saisissez l’identifiant d’un modèle accessible à votre
                compte.
                {harness === 'opencode' &&
                  ' Pour OpenCode, utilisez le format fournisseur/modèle (préfixe openai/ ou anthropic/ selon votre clé).'}
              </li>
              <li>
                Cliquez sur « Créer le profil pour ce compte », puis sur « Tester » à côté de son
                nom. Le test envoie une courte demande réelle au fournisseur et peut être facturé.
              </li>
              <li>
                Une fois le profil « Prêt », sélectionnez-le comme « Profil par défaut » pour
                l’utiliser avec Jarvis et les agents sans choix spécifique, ou affectez-le à un
                agent dans sa fiche.
              </li>
            </ol>
          </section>
          <section>
            <h3>Si la connexion échoue</h3>
            <p>
              Vérifiez l’état d’installation et le résultat dans « Opérations récentes ». Avec une
              clé API, vérifiez aussi le fournisseur, la validité de la clé, le crédit disponible et
              l’accès au modèle choisi. Enregistrer la clé ne prouve pas l’accès au modèle : le test
              du profil le vérifie.
            </p>
            <p className="muted">
              Collez votre clé uniquement dans le champ « Clé API », jamais dans une conversation.
              Les liens de cette aide s’ouvrent dans un nouvel onglet.
            </p>
          </section>
        </div>
        <footer className="harness-help-footer">
          <button type="button" className="secondary" onClick={() => dialog.current?.close()}>
            Fermer l’aide
          </button>
        </footer>
      </dialog>
    </>
  );
}
