import { GitHubPublication } from './GitHubPublication.tsx';
import type { DevelopmentChange } from '../../../packages/contracts/src/development.ts';
const labels: Record<string, string> = {
  working: 'Développement en cours',
  validating: 'Vérification en cours',
  reviewing: 'Revue en cours',
  proposed: 'Proposition prête',
  tests_failed: 'Tests en échec',
  changes_requested: 'Corrections demandées',
  failed: 'Développement interrompu',
  cancelled: 'Développement arrêté',
};
export function DevelopmentChanges({ changes }: { changes: DevelopmentChange[] }) {
  if (!changes.length) return null;
  return (
    <section className="development-changes" aria-label="Propositions de code">
      {changes.map((c) => (
        <article className="development-change" key={c.id}>
          <h3>{labels[c.status] ?? c.status}</h3>
          <p>{c.task}</p>
          <p className="muted">Copie isolée de Jarvis · Aucun déploiement</p>
          {c.artifact && (
            <>
              <p>
                {c.artifact.files.length} fichier(s) modifié(s) ·{' '}
                <a href={`/api/v1/development/${c.id}/patch`} download>
                  Télécharger le patch
                </a>
              </p>
              <details>
                <summary>Voir les modifications</summary>
                <pre>{c.artifact.patch}</pre>
              </details>
              <p className="muted">
                Empreinte du patch : <code>{c.artifact.digest}</code>
              </p>
            </>
          )}
          {c.validation && (
            <details>
              <summary>
                {c.validation.passed ? 'Vérifications réussies' : 'Vérifications en échec'}
              </summary>
              <pre>{c.validation.output}</pre>
            </details>
          )}
          {c.review && (
            <details open>
              <summary>
                Revue · {c.review.verdict === 'approve' ? 'Favorable' : 'Corrections demandées'}
              </summary>
              <p className="preserved-text">{c.review.summary}</p>
            </details>
          )}
          <GitHubPublication change={c} />
          {c.error && <p className="notice error">{c.error}</p>}
        </article>
      ))}
    </section>
  );
}
