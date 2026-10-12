import { ReleaseReadiness } from './ReleaseReadiness.tsx';
import { useEffect, useState } from 'react';
import { api } from './api.ts';
import type { DevelopmentChange } from '../../../packages/contracts/src/development.ts';
type Publication = {
  state: string;
  error?: string;
  result?: { url: string; number: number; state: string; commit?: string };
};
export function GitHubPublication({ change }: { change: DevelopmentChange }) {
  const [publication, setPublication] = useState<Publication | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const eligible = change.status === 'proposed' && Boolean(change.source?.commit);
  useEffect(() => {
    if (!eligible) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const d = await api<{ publication: Publication | null }>(
          `/development/${change.id}/github`,
        );
        if (!active) return;
        setPublication(d.publication);
        if (d.publication && ['queued', 'running'].includes(d.publication.state))
          timer = setTimeout(() => void poll(), 2000);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Statut GitHub indisponible.');
      }
    };
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [change.id, eligible, busy]);
  async function publish() {
    setBusy(true);
    setError('');
    try {
      const d = await api<{ publication: Publication }>(`/development/${change.id}/github`, {
        digest: change.artifact!.digest,
      });
      setPublication(d.publication);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Publication interrompue.');
    } finally {
      setBusy(false);
    }
  }
  if (!eligible)
    return change.status === 'proposed' ? (
      <p className="muted">
        Pour créer une PR, configurez GitHub puis lancez une nouvelle mission depuis le dépôt.
      </p>
    ) : null;
  return (
    <div className="github-publication">
      <p className="muted">
        {change.source!.repository} · {change.source!.branch} · base{' '}
        {change.source!.commit!.slice(0, 8)}
      </p>
      {publication?.state === 'succeeded' && publication.result ? (
        <a className="secondary" href={publication.result.url} target="_blank" rel="noreferrer">
          Ouvrir la pull request #{publication.result.number}
        </a>
      ) : (
        <button
          className="secondary"
          disabled={
            busy || Boolean(publication && ['queued', 'running'].includes(publication.state))
          }
          onClick={() => void publish()}
        >
          {busy || publication?.state === 'queued' || publication?.state === 'running'
            ? 'Préparation de la pull request…'
            : publication?.state === 'failed'
              ? 'Réessayer ou retrouver la PR'
              : 'Créer une pull request en brouillon'}
        </button>
      )}
      {(error || publication?.error) && (
        <p className="notice error" role="alert">
          {error || publication?.error}
        </p>
      )}
      {publication?.state === 'succeeded' && publication.result?.commit && (
        <ReleaseReadiness
          id={change.id}
          digest={change.artifact!.digest}
          commit={publication.result.commit}
        />
      )}
      <p className="muted">
        Aucune fusion ni aucun déploiement. Une branche peut subsister si la création de la PR est
        interrompue.
      </p>
    </div>
  );
}
