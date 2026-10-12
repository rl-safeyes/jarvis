import { useEffect, useState } from 'react';
import { api } from './api.ts';
interface Dashboard {
  settings: { repository: string | null; base_branch: string; revision: number };
  connection: {
    state: string;
    account?: string;
    error?: string;
    login?: { code: string | null; verification_url: string; expires_at: string };
  };
}
export function GitHubSettings() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [repository, setRepository] = useState('rl-safeyes/jarvis');
  const [branch, setBranch] = useState('main');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function refresh(initial = false) {
    const result = await api<Dashboard>('/github');
    setData(result);
    if (initial) {
      setRepository(result.settings.repository ?? 'rl-safeyes/jarvis');
      setBranch(result.settings.base_branch);
    }
  }
  useEffect(() => {
    let active = true;
    void api<Dashboard>('/github')
      .then((d) => {
        if (active) {
          setData(d);
          setRepository(d.settings.repository ?? 'rl-safeyes/jarvis');
          setBranch(d.settings.base_branch);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (data?.connection.state !== 'connecting') return;
    const timer = setInterval(() => void refresh().catch((e) => setError(e.message)), 3000);
    return () => clearInterval(timer);
  }, [data?.connection.state]);
  async function action(path: string, body: unknown = {}) {
    setBusy(true);
    setError('');
    try {
      await api(path, body);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Connexion GitHub indisponible.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="settings-card github-settings" aria-label="Connexion GitHub">
      <h2>GitHub · Développement</h2>
      <p>
        Connectez votre compte pour préparer les modifications depuis le dépôt et ouvrir des pull
        requests en brouillon.
      </p>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      <p>
        {data?.connection.state === 'connected'
          ? `Connecté avec ${data.connection.account}`
          : data?.connection.state === 'connecting'
            ? 'Connexion en attente dans GitHub…'
            : 'Compte GitHub non connecté'}
      </p>
      {data?.connection.state === 'connected' ? (
        <button
          className="secondary"
          disabled={busy}
          onClick={() => void action('/github/disconnect')}
        >
          Déconnecter GitHub
        </button>
      ) : (
        <button
          className="primary"
          disabled={busy || data?.connection.state === 'connecting'}
          onClick={() => void action('/github/connect')}
        >
          Se connecter à GitHub dans le navigateur
        </button>
      )}
      {data?.connection.login && (
        <div className="notice">
          <p>1. Ouvrez GitHub et connectez-vous à votre compte.</p>
          <p>
            2. Saisissez le code :{' '}
            <strong>{data.connection.login.code ?? 'Obtention du code…'}</strong>
          </p>
          <p>
            3. Autorisez GitHub CLI, puis revenez ici. La connexion est vérifiée automatiquement.
          </p>
          <a href="https://github.com/login/device" target="_blank" rel="noreferrer">
            Ouvrir la connexion GitHub
          </a>
          <p>
            Le code expire à{' '}
            {new Date(data.connection.login.expires_at).toLocaleTimeString('fr-FR')}.
          </p>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void action('/github/disconnect')}
          >
            Annuler la connexion GitHub
          </button>
        </div>
      )}
      {data?.connection.error && (
        <p className="notice error">La connexion n’a pas abouti ou a expiré. Relancez-la.</p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (data)
            void action('/github/repository', {
              repository,
              branch,
              revision: data.settings.revision,
            });
        }}
      >
        <label>
          Dépôt GitHub
          <input
            aria-label="Dépôt GitHub"
            value={repository}
            onChange={(e) => setRepository(e.target.value)}
            placeholder="propriétaire/dépôt"
            required
          />
        </label>
        <label>
          Branche de départ
          <input
            aria-label="Branche de départ"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            required
          />
        </label>
        <button className="secondary" disabled={busy || data?.connection.state !== 'connected'}>
          Vérifier et enregistrer le dépôt
        </button>
      </form>
      {data?.settings.repository && (
        <p>
          Prochaines missions : {data.settings.repository} · {data.settings.base_branch}
        </p>
      )}
      <details>
        <summary>Comment fonctionne l’accès GitHub ?</summary>
        <p>
          Le parcours officiel GitHub CLI utilise un code temporaire. GitHub peut demander une
          autorisation supplémentaire pour votre organisation. Le compte doit pouvoir écrire dans le
          dépôt sélectionné.
        </p>
        <p>
          La connexion appartient au conteneur GitHub de Jarvis. Les agents et leurs terminaux ne
          reçoivent aucun jeton. Chaque mission fige un commit ; un changement de la branche de
          départ exige une nouvelle mission avant publication.
        </p>
        <p>
          Une PR est créée uniquement quand vous cliquez sur le bouton de la proposition testée et
          revue. Elle reste en brouillon : aucune fusion ni aucun déploiement automatique.
        </p>
      </details>
    </section>
  );
}
