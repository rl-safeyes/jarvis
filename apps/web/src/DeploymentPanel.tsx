import { useEffect, useState } from 'react';
import { api } from './api.ts';
export type Deployment = {
  id: string;
  state: string;
  revision: number;
  commit: string;
  policy_digest: string;
  automatic: boolean;
  image: string | null;
  previous_image: string | null;
  error: string | null;
  monitor_until: string | null;
};
const labels: Record<string, string> = {
  preparing: 'Construction et test des deux versions',
  awaiting_approval: 'Image testée — approbation attendue',
  queued: 'Release approuvée',
  merging: 'Fusion contrôlée',
  merge_unknown: 'Fusion à réconcilier',
  deploying: 'Mise à jour en cours',
  monitoring: 'Nouvelle version sous surveillance',
  succeeded: 'Version déployée',
  rollback_pending: 'Retour arrière en cours',
  rolled_back: 'Version précédente restaurée',
  rollback_failed: 'Intervention opérateur nécessaire',
  blocked: 'Release bloquée',
  cancelled: 'Release annulée',
};
export function DeploymentCard({
  deployment,
  onChange,
}: {
  deployment: Deployment;
  onChange: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const d = deployment;
  async function act(action: string) {
    setBusy(true);
    setError('');
    try {
      await api(`/deployments/${d.id}/action`, {
        action,
        revision: d.revision,
        image: d.image,
        commit: d.commit,
        policy_digest: d.policy_digest,
      });
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action indisponible.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="release-readiness">
      <p role="status">{labels[d.state] ?? d.state}</p>
      <p className="muted">
        Commit {d.commit.slice(0, 8)}
        {d.automatic ? ' · mode automatique' : ''}
      </p>
      {d.image && (
        <details>
          <summary>Image préparée</summary>
          <code className="release-image">{d.image}</code>
        </details>
      )}
      {d.monitor_until && d.state === 'monitoring' && (
        <p>Surveillance jusqu’à {new Date(d.monitor_until).toLocaleTimeString('fr-FR')}.</p>
      )}
      {d.state === 'awaiting_approval' && (
        <>
          <p>
            L’approbation autorise la fusion de ce commit et le déploiement de cette image. Une
            courte interruption est possible.
          </p>
          <button disabled={busy} onClick={() => void act('approve')}>
            Approuver la fusion et le déploiement
          </button>
          <button className="secondary" disabled={busy} onClick={() => void act('cancel')}>
            Annuler cette release
          </button>
        </>
      )}
      {['monitoring', 'succeeded', 'rollback_failed'].includes(d.state) && (
        <button className="secondary" disabled={busy} onClick={() => void act('rollback')}>
          Restaurer la version précédente
        </button>
      )}
      {d.state === 'merge_unknown' && (
        <button className="secondary" disabled={busy} onClick={() => void act('reconcile')}>
          Réconcilier la fusion
        </button>
      )}
      {(error || d.error) && (
        <p role="alert" className="notice error">
          {error || d.error}
        </p>
      )}
      {d.state === 'rolled_back' && (
        <p>
          Le code reste fusionné sur GitHub. Une nouvelle proposition doit corriger la régression.
        </p>
      )}
    </div>
  );
}
export function DeploymentPanel({
  id,
  digest,
  commit,
  policy,
  eligible,
}: {
  id: string;
  digest: string;
  commit: string;
  policy: string;
  eligible: boolean;
}) {
  const [deployment, setDeployment] = useState<Deployment | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const d = await api<{ deployment: Deployment | null }>(`/development/${id}/deployment`);
        if (!active) return;
        setDeployment(d.deployment);
        if (
          d.deployment &&
          ![
            'succeeded',
            'rolled_back',
            'blocked',
            'cancelled',
            'rollback_failed',
            'merge_unknown',
          ].includes(d.deployment.state)
        )
          timer = setTimeout(() => void poll(), 5000);
      } catch {
        if (active) timer = setTimeout(() => void poll(), 5000);
      }
    };
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [id, refresh]);
  async function prepare() {
    setBusy(true);
    setError('');
    try {
      const r = await api<{ deployment: Deployment }>(`/development/${id}/deployment`, {
        digest,
        commit,
        policy_digest: policy,
      });
      setDeployment(r.deployment);
      setRefresh((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Préparation indisponible.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Déploiement de la proposition">
      {(!deployment || ['blocked', 'cancelled', 'rolled_back'].includes(deployment.state)) && (
        <button className="secondary" disabled={busy || !eligible} onClick={() => void prepare()}>
          {busy ? 'Préparation…' : 'Préparer la fusion et le déploiement'}
        </button>
      )}
      {error && <p role="alert">{error}</p>}
      {deployment && (
        <DeploymentCard deployment={deployment} onChange={() => setRefresh((v) => v + 1)} />
      )}
    </section>
  );
}
