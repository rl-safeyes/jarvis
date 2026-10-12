import { DeploymentPanel } from './DeploymentPanel.tsx';
import { useEffect, useState } from 'react';
import { api } from './api.ts';
type Report = {
  state: string;
  commit: string;
  checked_at: string;
  policy_version: string;
  policy_digest: string;
  blockers: string[];
  risk: { level: string; reasons: string[]; files: number; lines: number } | null;
  checks: { name: string; passed: boolean }[];
  run: { url: string; attempt: number } | null;
};
export function ReleaseReadiness({
  id,
  digest,
  commit,
}: {
  id: string;
  digest: string;
  commit: string;
}) {
  const [data, setData] = useState<{ report: Report | null; stale: boolean } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void api<{ report: Report | null; stale: boolean }>(`/development/${id}/release`)
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [id, commit, digest]);
  async function check() {
    setBusy(true);
    setError('');
    try {
      setData(await api(`/development/${id}/release`, { digest, commit }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Vérification indisponible.');
    } finally {
      setBusy(false);
    }
  }
  const report = data?.report;
  return (
    <section aria-label="Préparation de la release" className="release-readiness">
      <h4>Préproduction et risque</h4>
      <button className="secondary" disabled={busy} onClick={() => void check()}>
        {busy ? 'Vérification en cours…' : 'Vérifier la préproduction'}
      </button>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {report && (
        <>
          <p role="status">
            {data?.stale
              ? 'Rapport périmé — relancez la vérification.'
              : report.state === 'passed'
                ? 'Préproduction validée'
                : report.state === 'waiting'
                  ? 'Contrôles en attente'
                  : 'Qualification bloquée'}
          </p>
          <p className="muted">
            Commit {report.commit.slice(0, 8)} · vérifié le{' '}
            {new Date(report.checked_at).toLocaleString('fr-FR')}
          </p>
          {report.risk && (
            <>
              <p>
                Risque :{' '}
                {{ low: 'faible', medium: 'intermédiaire', high: 'élevé' }[report.risk.level] ??
                  'inconnu'}{' '}
                · {report.risk.files} fichier(s), {report.risk.lines} ligne(s)
              </p>
              <ul>
                {report.risk.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </>
          )}
          {!!report.blockers.length && (
            <ul>
              {report.blockers.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
          {!!report.checks.length && (
            <ul>
              {report.checks.map((c) => (
                <li key={c.name}>
                  {c.name === 'preproduction' ? 'Préproduction isolée' : 'Compilation et tests'} :{' '}
                  {c.passed ? 'réussi' : 'non validé'}
                </li>
              ))}
            </ul>
          )}
          {report.run && (
            <a href={report.run.url} target="_blank" rel="noreferrer">
              Voir les contrôles GitHub
            </a>
          )}
        </>
      )}
      {report && (
        <DeploymentPanel
          id={id}
          digest={digest}
          commit={commit}
          policy={report.policy_digest}
          eligible={!data?.stale && report.state === 'passed' && report.risk?.level !== 'high'}
        />
      )}
      <p className="muted">
        La préproduction utilise des données synthétiques et un moteur simulé. Ce rapport ne
        déclenche aucune fusion ni mise en production. Il doit être actualisé après tout changement.
      </p>
    </section>
  );
}
