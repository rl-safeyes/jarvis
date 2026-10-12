import { useEffect, useState } from 'react';
import { api } from './api.ts';
import { DeploymentCard, type Deployment } from './DeploymentPanel.tsx';
export function ReleaseSettings() {
  const [data, setData] = useState<any>(null),
    [policy, setPolicy] = useState<string>(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const [d, p] = await Promise.all([
          api<any>('/release-settings'),
          api<any>('/release-policy'),
        ]);
        if (active) {
          setData(d);
          setPolicy(p.digest);
        }
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Contrôleur indisponible.');
      }
    };
    void load();
    const timer = setInterval(() => void load(), 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [refresh]);
  async function toggle() {
    setBusy(true);
    setError('');
    try {
      await api('/release-settings', {
        auto_enabled: !data.settings.auto_enabled,
        revision: data.settings.revision,
        policy_digest: policy,
      });
      setRefresh((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Réglage indisponible.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="settings-card" aria-label="Releases et retour arrière">
      <h2>Releases et retour arrière</h2>
      <p>
        Les changements de documentation peuvent être préparés, fusionnés et déployés
        automatiquement après leurs contrôles. Les changements d’interface demandent l’approbation
        de l’image testée. Les migrations et le cœur de contrôle nécessitent une procédure dédiée.
      </p>
      <p>
        {data?.settings.controller_online
          ? 'Contrôleur disponible'
          : 'Contrôleur indisponible ou occupé par une préparation'}
      </p>
      <p>
        Autonomie documentaire :{' '}
        {data?.settings.auto_enabled && data.settings.policy_digest === policy
          ? 'activée'
          : 'désactivée'}
      </p>
      <button
        className="secondary"
        disabled={busy || !data || !policy}
        onClick={() => void toggle()}
      >
        {data?.settings.auto_enabled
          ? 'Désactiver les releases automatiques'
          : 'Activer les releases automatiques de documentation'}
      </button>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {data?.deployments.map((d: Deployment) => (
        <DeploymentCard key={d.id} deployment={d} onChange={() => setRefresh((v) => v + 1)} />
      ))}
    </section>
  );
}
