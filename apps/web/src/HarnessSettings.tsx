import { useEffect, useState } from 'react';
import { api } from './api.ts';
import { HarnessConnectionHelp } from './HarnessConnectionHelp.tsx';
import type {
  HarnessDashboard,
  HarnessId,
  HarnessLogin,
  HarnessAccountStatus,
} from '../../../packages/contracts/src/harnesses.ts';

export function HarnessSettings({ onChange }: { onChange: () => void }) {
  const [data, setData] = useState<HarnessDashboard | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [accountName, setAccountName] = useState('Compte personnel');
  const [harness, setHarness] = useState<HarnessId>('codex');
  const [selected, setSelected] = useState('');
  const [secret, setSecret] = useState('');
  const [provider, setProvider] = useState('openai');
  const [model, setModel] = useState('');
  const [profileName, setProfileName] = useState('Mon profil');
  const [models, setModels] = useState<{ id: string; name: string }[]>([]);
  const [login, setLogin] = useState<HarnessLogin | null>(null);
  const [loginCode, setLoginCode] = useState('');
  const [authMethod, setAuthMethod] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const refresh = async () => {
    const d = await api<HarnessDashboard>('/harnesses');
    setData(d);
    return d;
  };
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
    const timer = setInterval(() => void refresh().catch(() => {}), 3000);
    return () => clearInterval(timer);
  }, []);
  const account = data?.accounts.find((x) => x.id === selected);
  async function action(work: () => Promise<unknown>, success = 'Configuration enregistrée.') {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
      await refresh();
      onChange();
      setNotice(success);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Opération impossible.');
    } finally {
      setBusy(false);
    }
  }
  async function checkAccount() {
    const r = await api<HarnessAccountStatus>(`/accounts/${selected}/status`);
    setLogin(r.login ?? null);
    setAuthMethod(r.auth_method ?? null);
    if (r.error_code)
      throw new Error(
        r.error_code === 'auth_expired'
          ? 'La connexion Claude a expiré. Relancez la connexion à votre abonnement.'
          : 'La connexion Claude a échoué. Relancez-la et utilisez le code du nouveau lien.',
      );
    if (r.state === 'ready') {
      const m = await api<{ models: typeof models }>(`/accounts/${selected}/models`);
      setModels(m.models);
      setNotice('Compte connecté. Créez puis testez un profil.');
    } else
      setNotice('Connexion en attente. Suivez le parcours fournisseur puis vérifiez à nouveau.');
  }
  useEffect(() => {
    setLogin(null);
    setLoginCode('');
    setAuthMethod(null);
    setModels([]);
    setSecret('');
    setModel('');
    if (selected) void action(checkAccount, 'État du compte actualisé.');
  }, [selected]);
  if (!data) return <p role="status">Chargement de la configuration…</p>;
  return (
    <div className="harness-settings">
      <h1>Les moteurs de votre Jarvis.</h1>
      <p className="page-intro">
        Installez un harness, connectez votre compte puis testez un profil. Le profil associe un
        moteur, un compte et un modèle.
      </p>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      <section className="settings-card">
        <h2>1. Harnesses disponibles</h2>
        <div className="harness-grid">
          {data.harnesses.map((h) => (
            <article key={h.id} className="harness-card">
              <div className="harness-card-heading">
                <h3>{h.name}</h3>
                <HarnessConnectionHelp harness={h.id} name={h.name} />
              </div>
              <p>Version {h.version}</p>
              <p>
                {(
                  {
                    absent: 'À installer',
                    installed: 'Installé dans Docker',
                    installing: 'Installation en cours',
                    failed: 'Installation interrompue',
                  } as Record<string, string>
                )[h.state] ?? h.state}
              </p>
              {h.error && <p role="alert">{h.error}</p>}
              <button
                className="secondary"
                disabled={busy || h.state === 'installed' || h.state === 'installing'}
                onClick={() =>
                  void action(
                    () => api('/harness-installations', { id: crypto.randomUUID(), harness: h.id }),
                    'Installation demandée. Son avancement apparaît ci-dessous.',
                  )
                }
              >
                Installer {h.name}
              </button>
            </article>
          ))}
        </div>
      </section>
      <section className="settings-card">
        <h2>2. Connecter un compte</h2>
        <form
          className="harness-form"
          onSubmit={(e) => {
            e.preventDefault();
            void action(async () => {
              const id = crypto.randomUUID();
              await api('/accounts', { id, name: accountName, harness });
              setSelected(id);
            }, 'Compte créé. Choisissez votre mode de connexion.');
          }}
        >
          <label>
            Harness
            <select value={harness} onChange={(e) => setHarness(e.target.value as HarnessId)}>
              {data.harnesses.map((h) => (
                <option value={h.id} key={h.id} disabled={h.state !== 'installed'}>
                  {h.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Nom du compte
            <input
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
              required
              maxLength={80}
            />
          </label>
          <button
            className="secondary"
            disabled={busy || data.harnesses.find((h) => h.id === harness)?.state !== 'installed'}
          >
            Ajouter ce compte
          </button>
        </form>
        <label className="field">
          Compte à connecter
          <select value={selected} onChange={(e) => setSelected(e.target.value)}>
            <option value="">Choisir un compte</option>
            {data.accounts.map((a) => (
              <option value={a.id} key={a.id}>
                {a.name} · {a.harness} · {a.state}
              </option>
            ))}
          </select>
        </label>
        {account && (
          <div>
            {(account.harness === 'codex' || account.harness === 'claude-code') && (
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    const r = await api<{ login: typeof login }>(`/accounts/${selected}/connect`, {
                      method: account.harness === 'claude-code' ? 'claude_subscription' : 'device',
                    });
                    setLogin(r.login);
                    setLoginCode('');
                    setAuthMethod(null);
                  }, 'Connexion démarrée. Suivez le lien fournisseur.')
                }
              >
                {account.harness === 'claude-code'
                  ? 'Se connecter avec mon abonnement Claude'
                  : 'Se connecter avec ChatGPT'}
              </button>
            )}
            {account.harness === 'claude-code' && (
              <p className="muted">
                La connexion à l’abonnement ouvre le site Claude et remplace la clé API de ce
                compte.
                {authMethod === 'claude_subscription' && (
                  <strong> Mode actif : abonnement Claude.</strong>
                )}
                {authMethod === 'api_key' && (
                  <strong> Mode actif : facturation API Anthropic.</strong>
                )}
              </p>
            )}
            {login && (
              <div className="auth-card">
                {login.kind === 'claude_subscription' ? (
                  <p>
                    Ouvrez le lien, connectez-vous au compte portant votre abonnement Claude et
                    autorisez Claude Code. Si le site affiche un code, copiez-le ci-dessous.
                  </p>
                ) : (
                  <>
                    <p>Ouvrez le site fournisseur et saisissez ce code :</p>
                    <strong>{login.userCode}</strong>
                  </>
                )}
                <p>
                  <a href={login.verificationUrl} target="_blank" rel="noreferrer">
                    Ouvrir la connexion sécurisée
                  </a>
                </p>
                {login.kind === 'claude_subscription' && (
                  <form
                    className="harness-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const code = loginCode.trim();
                      const loginId = login.loginId;
                      setLoginCode('');
                      void action(async () => {
                        await api(`/accounts/${selected}/connect/complete`, { loginId, code });
                        await checkAccount();
                      }, 'Code transmis. Si le compte est connecté, créez puis testez un profil.');
                    }}
                  >
                    <label>
                      Code de connexion Claude
                      <input
                        type="password"
                        autoComplete="off"
                        autoCapitalize="none"
                        spellCheck={false}
                        value={loginCode}
                        onChange={(e) => setLoginCode(e.target.value)}
                        required
                        minLength={10}
                        maxLength={4096}
                      />
                    </label>
                    <button className="secondary" disabled={busy || !loginCode.trim()}>
                      Valider le code Claude
                    </button>
                  </form>
                )}
                <p>À terminer avant {new Date(login.expires_at).toLocaleTimeString('fr-FR')}.</p>
              </div>
            )}
            <form
              className="harness-form"
              onSubmit={(e) => {
                e.preventDefault();
                const value = secret;
                setSecret('');
                setLogin(null);
                setLoginCode('');
                setAuthMethod(null);
                void action(
                  () =>
                    api(`/accounts/${selected}/connect`, {
                      method: 'api_key',
                      secret: value,
                      ...(account.harness === 'opencode' ? { provider } : {}),
                    }),
                  'Clé enregistrée : facturation API activée pour ce compte. Vérifiez la connexion puis testez un profil.',
                );
              }}
            >
              {account.harness === 'opencode' && (
                <label>
                  Fournisseur
                  <select value={provider} onChange={(e) => setProvider(e.target.value)}>
                    <option value="openai">OpenAI API</option>
                    <option value="anthropic">Anthropic API</option>
                  </select>
                </label>
              )}
              <label>
                Clé API {account.harness !== 'opencode' ? '(facturation API séparée)' : ''}
                <input
                  type="password"
                  autoComplete="off"
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  required
                  minLength={10}
                />
              </label>
              <button className="secondary" disabled={busy || !secret}>
                Enregistrer la clé
              </button>
            </form>
            <p className="muted">
              La clé est conservée pour ce compte, sans passer par le chat. Les appels API utilisent
              la facturation du fournisseur.
            </p>
            <div className="button-row">
              <button
                className="secondary"
                disabled={busy}
                onClick={() => void action(checkAccount, 'État du compte actualisé.')}
              >
                Vérifier la connexion
              </button>
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    await api(`/accounts/${selected}/disconnect`, {});
                    setLogin(null);
                    setAuthMethod(null);
                    setLoginCode('');
                  }, 'Compte déconnecté.')
                }
              >
                Déconnecter ce compte
              </button>
            </div>
          </div>
        )}
      </section>
      <section className="settings-card">
        <h2>3. Profils et modèle</h2>
        <p>
          Un test envoie une courte demande réelle au fournisseur. Un profil doit réussir ce test
          avant de devenir le défaut.
        </p>
        <form
          className="harness-form"
          onSubmit={(e) => {
            e.preventDefault();
            void action(
              () =>
                api('/execution-profiles', {
                  id: crypto.randomUUID(),
                  name: profileName,
                  account_id: selected,
                  model,
                }),
              'Profil créé. Lancez son test pour vérifier l’accès au modèle.',
            );
          }}
        >
          <label>
            Nom du profil
            <input
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
              required
              maxLength={80}
            />
          </label>
          <label>
            Modèle
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              list="harness-models"
              placeholder={
                account?.harness === 'opencode' ? 'fournisseur/modèle' : 'Identifiant du modèle'
              }
              required
              maxLength={150}
            />
            <datalist id="harness-models">
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </datalist>
          </label>
          <button className="secondary" disabled={busy || !selected || account?.state !== 'ready'}>
            Créer le profil pour ce compte
          </button>
        </form>
        {data.profiles.map((p) => (
          <div key={p.id} className="profile-row">
            <div>
              <strong>{p.name}</strong>
              <p>
                {p.harness} · {p.model} · {p.state === 'ready' ? 'Prêt' : 'À tester'}
              </p>
            </div>
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                void action(
                  () => api(`/execution-profiles/${p.id}/test`, { id: crypto.randomUUID() }),
                  'Test réel demandé. Son résultat apparaîtra ci-dessous.',
                )
              }
            >
              Tester {p.name}
            </button>
          </div>
        ))}
      </section>
      <section className="settings-card">
        <h2>4. Défaut et choix des agents</h2>
        <label className="field">
          Profil par défaut
          <select
            aria-label="Profil par défaut"
            value={data.settings.default_profile_id ?? ''}
            disabled={busy}
            onChange={(e) =>
              void action(() =>
                api('/runtime-settings', {
                  profile_id: e.target.value || null,
                  expected_revision: data.settings.revision,
                }),
              )
            }
          >
            <option value="">Aucun défaut</option>
            {data.profiles.map((p) => (
              <option key={p.id} value={p.id} disabled={p.state !== 'ready'}>
                {p.name} · {p.model}
              </option>
            ))}
          </select>
        </label>
        <p>
          Sans choix spécifique, Jarvis et les autres agents utilisent ce défaut. Les missions déjà
          démarrées gardent leur moteur.
        </p>
        {data.agents.map((a) => (
          <AgentEditor
            key={`${a.id}-${a.revision}`}
            agent={a}
            profiles={data.profiles}
            busy={busy}
            save={(instructions, profile) =>
              action(() =>
                api(`/agents/${a.id}/runtime`, {
                  instructions,
                  profile_id: profile,
                  expected_revision: a.revision,
                }),
              )
            }
          />
        ))}
      </section>
      <section className="settings-card">
        <h2>Opérations récentes</h2>
        {data.operations.length === 0 ? (
          <p>Aucune opération.</p>
        ) : (
          data.operations.map((o) => (
            <div className="profile-row" key={o.id}>
              <span>
                {
                  (
                    {
                      install: 'Installation',
                      test: 'Test de connexion',
                      mission: 'Mission',
                      github_publish: 'Pull request GitHub',
                    } as Record<string, string>
                  )[o.kind]
                }{' '}
                · {o.state}
              </span>
              {o.error && <p role="alert">{o.error}</p>}
            </div>
          ))
        )}
      </section>
    </div>
  );
}
function AgentEditor({
  agent,
  profiles,
  busy,
  save,
}: {
  agent: HarnessDashboard['agents'][number];
  profiles: HarnessDashboard['profiles'];
  busy: boolean;
  save: (instructions: string, profile: string | null) => Promise<void>;
}) {
  const [text, setText] = useState(agent.instructions);
  const [profile, setProfile] = useState(agent.profile_id ?? '');
  return (
    <details className="agent-editor">
      <summary>
        {agent.id} · {agent.profile_id ? 'Choix spécifique' : 'Hérite du défaut'} ·{' '}
        {profiles.find((p) => p.id === agent.effective_profile_id)?.name ?? 'À configurer'}
      </summary>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save(text, profile || null);
        }}
        className="harness-form"
      >
        <label>
          Profil de {agent.id}
          <select value={profile} onChange={(e) => setProfile(e.target.value)}>
            <option value="">Utiliser le défaut</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id} disabled={p.state !== 'ready'}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Instructions
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            required
            maxLength={20000}
            rows={4}
          />
        </label>
        <button className="secondary" disabled={busy}>
          Enregistrer la fiche
        </button>
      </form>
    </details>
  );
}
