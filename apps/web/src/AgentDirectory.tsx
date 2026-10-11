import { useEffect, useRef, useState } from 'react';
import type { AgentDefinition, Department } from '@jarvis/contracts';
import type { HarnessDashboard } from '../../../packages/contracts/src/harnesses.ts';
import { api } from './api.ts';

type Catalogue = { agents: AgentDefinition[]; departments: Department[] };
export function AgentDirectory({
  profiles,
  live,
  onChange,
}: {
  profiles: HarnessDashboard['profiles'];
  live: boolean;
  onChange: () => void;
}) {
  const [data, setData] = useState<Catalogue>({ agents: [], departments: [] });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [department, setDepartment] = useState('Produit');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [profile, setProfile] = useState('');
  const pending = useRef<{ key: string; id: string } | null>(null);
  const refresh = async () => setData(await api<Catalogue>('/agents'));
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
  }, []);
  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    const input = { name, department, description, instructions, profile_id: profile || null };
    const key = JSON.stringify(input);
    if (pending.current?.key !== key) pending.current = { key, id: crypto.randomUUID() };
    try {
      await api('/agents', { ...input, request_id: pending.current.id });
      pending.current = null;
      setName('');
      setDescription('');
      setInstructions('');
      await refresh();
      onChange();
      setNotice('Agent créé. Vous pouvez lui confier une tâche depuis le chat.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Création impossible.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <span className="eyebrow">LES COMPÉTENCES DE VOTRE ESPACE</span>
      <h1>Une équipe, un orchestrateur.</h1>
      <p className="page-intro">
        Demandez à Jarvis de créer un spécialiste et de lui confier une tâche, ou préparez sa fiche
        ici. Les agents peuvent rédiger et analyser les informations que vous leur fournissez.
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
      {live && (
        <details className="settings-card">
          <summary>Créer un agent</summary>
          <form className="harness-form agent-create-form" onSubmit={create}>
            <label>
              Nom de l’agent
              <input
                required
                minLength={2}
                maxLength={70}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              Département
              <input
                required
                minLength={2}
                maxLength={60}
                list="agent-departments"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
              />
              <datalist id="agent-departments">
                {data.departments.map((d) => (
                  <option key={d.id} value={d.name} />
                ))}
              </datalist>
            </label>
            <label>
              Rôle
              <input
                required
                maxLength={500}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
            <label>
              Instructions
              <textarea
                required
                minLength={10}
                maxLength={12000}
                rows={4}
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
              />
            </label>
            <label>
              Profil d’exécution
              <select value={profile} onChange={(e) => setProfile(e.target.value)}>
                <option value="">Hériter du défaut global</option>
                {profiles
                  .filter((p) => p.state === 'ready')
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {p.harness}
                    </option>
                  ))}
              </select>
            </label>
            <button className="secondary" disabled={busy}>
              Créer ce spécialiste
            </button>
          </form>
        </details>
      )}
      <div className="department-grid">
        {data.departments.map((dept) => (
          <section className="department-card" key={dept.id}>
            <div className="department-title">
              <h2>{dept.name}</h2>
            </div>
            <p>{dept.description}</p>
            {data.agents
              .filter((a) => a.department_id === dept.id)
              .map((a) => (
                <AgentCard
                  key={a.id}
                  agent={a}
                  profiles={profiles}
                  live={live}
                  changed={async () => {
                    await refresh();
                    onChange();
                  }}
                />
              ))}
          </section>
        ))}
      </div>
    </>
  );
}
function AgentCard({
  agent,
  profiles,
  live,
  changed,
}: {
  agent: AgentDefinition;
  profiles: HarnessDashboard['profiles'];
  live: boolean;
  changed: () => Promise<void>;
}) {
  const [text, setText] = useState(agent.instructions ?? '');
  const [profile, setProfile] = useState(agent.profile_id ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [versions, setVersions] = useState<
    { revision: number; instructions: string; profile_id: string | null }[]
  >([]);
  useEffect(() => {
    setText(agent.instructions ?? '');
    setProfile(agent.profile_id ?? '');
  }, [agent.revision, agent.instructions, agent.profile_id]);
  return (
    <article className="agent-card">
      <div className="agent-card-head">
        <strong>{agent.name}</strong>
        <span className="text-tag">
          {live && agent.status === 'ready' ? 'PRÊT' : live ? 'À CONFIGURER' : 'SIMULATION'}
        </span>
      </div>
      <p>{agent.description}</p>
      <p className="agent-engine">
        Version {(agent.revision ?? 0) + 1} ·{' '}
        {agent.profile_id
          ? (profiles.find((p) => p.id === agent.profile_id)?.name ?? 'Profil spécifique')
          : 'Hérite du défaut global'}
      </p>
      {live && (
        <details>
          <summary>Instructions et versions</summary>
          {error && (
            <p role="alert" className="notice error">
              {error}
            </p>
          )}
          <form
            className="agent-config"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError('');
              try {
                await api(`/agents/${agent.id}/runtime`, {
                  instructions: text,
                  profile_id: profile || null,
                  expected_revision: agent.revision,
                });
                setVersions([]);
                await changed();
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Enregistrement impossible.');
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Instructions de {agent.name}
              <textarea
                required
                minLength={10}
                maxLength={12000}
                rows={5}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </label>
            <label>
              Profil de {agent.name}
              <select value={profile} onChange={(e) => setProfile(e.target.value)}>
                <option value="">Hériter du défaut global</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id} disabled={p.state !== 'ready'}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <button className="secondary" disabled={busy}>
              Enregistrer une version
            </button>
          </form>
          <button
            className="secondary"
            onClick={() => {
              void api<{ versions: typeof versions }>(`/agents/${agent.id}/versions`)
                .then((r) => setVersions(r.versions))
                .catch((e) => setError(e.message));
            }}
          >
            Afficher l’historique
          </button>
          {versions.map((v) => (
            <details key={v.revision}>
              <summary>Version {v.revision + 1}</summary>
              <p className="preserved-text">{v.instructions}</p>
              <p>
                {v.profile_id
                  ? (profiles.find((p) => p.id === v.profile_id)?.name ?? 'Profil spécifique')
                  : 'Hérite du défaut global'}
              </p>
            </details>
          ))}
        </details>
      )}
    </article>
  );
}
