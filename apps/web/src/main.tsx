import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity,
  ArrowUp,
  Bot,
  Check,
  ChevronRight,
  Clock3,
  Code2,
  FlaskConical,
  LayoutGrid,
  LogOut,
  Menu,
  MessageSquare,
  Mic,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Square,
  WifiOff,
  X,
} from 'lucide-react';
import { z } from 'zod';
import {
  isTerminal,
  type AgentDefinition,
  type Conversation,
  type ConversationDetail,
  type Department,
  type Mission,
  type MissionEvent,
  type SessionInfo,
} from '@jarvis/contracts';
import { api, ApiError, setCsrfToken } from './api.ts';
import './styles.css';

const pendingSchema = z.object({
  text: z.string(),
  createId: z.uuid(),
  messageId: z.uuid(),
  conversationId: z.uuid().nullable(),
  version: z.number().int().nonnegative(),
});
type Pending = z.infer<typeof pendingSchema>;
function stored(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function store(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* Private browsing may disable storage. */
  }
}
function readPending(): Pending | null {
  try {
    return pendingSchema.parse(JSON.parse(stored('jarvis.pending') ?? 'null'));
  } catch {
    return null;
  }
}
const statusLabel: Record<Mission['status'], string> = {
  queued: 'En attente',
  running: 'En cours',
  succeeded: 'Terminée',
  failed: 'Échec',
  cancelled: 'Arrêtée',
};
const shortDate = (value: string) =>
  new Date(value).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand">
      <img src="/icon.svg" alt="" />
      {!compact && (
        <div>
          jarvis<span>ESPACE PERSONNEL</span>
        </div>
      )}
    </div>
  );
}

function App() {
  const pendingRef = useRef<Pending | null>(readPending());
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [booting, setBooting] = useState(true);
  const [bootError, setBootError] = useState('');
  const [password, setPassword] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [error, setError] = useState('');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState<string | null>(
    () => pendingRef.current?.conversationId ?? stored('jarvis.conversation'),
  );
  const selectedRef = useRef(selected);
  const detailRequest = useRef(0);
  selectedRef.current = selected;
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [draft, setDraft] = useState(
    () => pendingRef.current?.text ?? stored('jarvis.draft') ?? '',
  );
  const [sending, setSending] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [view, setView] = useState<'chat' | 'organization' | 'settings'>('chat');
  const [menuOpen, setMenuOpen] = useState(false);
  const [catalogue, setCatalogue] = useState<{
    agents: AgentDefinition[];
    departments: Department[];
  }>({ agents: [], departments: [] });
  const [events, setEvents] = useState<MissionEvent[]>([]);
  const [streamState, setStreamState] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const latest = detail?.missions.at(-1);
  const active = latest && !isTerminal(latest.status);

  const authenticate = useCallback((value: SessionInfo) => {
    setCsrfToken(value.csrf_token);
    setSession(value);
    setError('');
  }, []);
  const report = useCallback((reason: unknown) => {
    if (reason instanceof ApiError && reason.status === 401) {
      setSession(null);
      setCsrfToken();
    }
    setError(reason instanceof Error ? reason.message : 'Connexion au serveur interrompue.');
  }, []);
  const bootstrap = useCallback(async () => {
    setBooting(true);
    setBootError('');
    try {
      authenticate(await api<SessionInfo>('/auth/session'));
    } catch (reason) {
      if (!(reason instanceof ApiError && reason.status === 401))
        setBootError('Le serveur est indisponible. Vérifiez son démarrage puis réessayez.');
    } finally {
      setBooting(false);
    }
  }, [authenticate]);
  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  useEffect(() => {
    store('jarvis.draft', draft);
  }, [draft]);
  const refreshList = useCallback(async () => {
    const result = await api<{ conversations: Conversation[] }>('/conversations');
    setConversations(result.conversations);
  }, []);
  const refreshDetail = useCallback(async (id: string) => {
    const request = ++detailRequest.current;
    const result = await api<ConversationDetail>(`/conversations/${id}`);
    if (selectedRef.current === id && request === detailRequest.current) setDetail(result);
  }, []);
  useEffect(() => {
    if (!session) return;
    void Promise.all([refreshList(), api<typeof catalogue>('/agents').then(setCatalogue)]).catch(
      report,
    );
  }, [session, refreshList, report]);
  useEffect(() => {
    setDetail(null);
    setEvents([]);
    store('jarvis.conversation', selected);
    if (selected && session)
      void refreshDetail(selected).catch((reason) => {
        if (selectedRef.current !== selected) return;
        if (reason instanceof ApiError && reason.status === 404) {
          setSelected(null);
          store('jarvis.conversation', null);
        } else report(reason);
      });
  }, [selected, session, refreshDetail, report]);
  useEffect(() => {
    if (!latest?.id || !session) return;
    setEvents([]);
    const source = new EventSource(`/api/v1/missions/${latest.id}/events`);
    source.onopen = () => setStreamState('');
    source.addEventListener('mission', (event: MessageEvent) => {
      const value: MissionEvent = JSON.parse(event.data);
      setEvents((previous) =>
        previous.some((item) => item.event_id === value.event_id)
          ? previous
          : [...previous, value].slice(-30),
      );
      if (
        ['mission.started', 'mission.completed', 'mission.cancelled', 'mission.failed'].includes(
          value.type,
        )
      )
        void Promise.all([refreshDetail(latest.conversation_id), refreshList()]).catch(report);
    });
    source.addEventListener('done', () => {
      source.close();
      setStreamState('');
    });
    source.onerror = () => {
      setStreamState('Reconnexion au suivi…');
      void api<SessionInfo>('/auth/session').catch(report);
    };
    return () => {
      source.close();
      setStreamState('');
    };
  }, [latest?.id, session, refreshDetail, refreshList, report]);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [detail?.messages.length, events.length]);

  async function login(event: React.FormEvent) {
    event.preventDefault();
    setLoginBusy(true);
    setError('');
    try {
      authenticate(await api<SessionInfo>('/auth/login', { password }));
      setPassword('');
    } catch (reason) {
      report(reason);
    } finally {
      setLoginBusy(false);
    }
  }
  function newConversation() {
    setSelected(null);
    setView('chat');
    setDraft('');
    setError('');
    setMenuOpen(false);
    pendingRef.current = null;
    store('jarvis.pending', null);
  }
  async function send(event?: React.FormEvent) {
    event?.preventDefault();
    const text = draft.trim();
    if (!text || sending || !online || active) return;
    setSending(true);
    setError('');
    let pending = pendingRef.current;
    if (!pending || pending.text !== text || pending.conversationId !== selected)
      pending = {
        text,
        createId: crypto.randomUUID(),
        messageId: crypto.randomUUID(),
        conversationId: selected,
        version: detail?.conversation.version ?? 0,
      };
    const persist = () => {
      pendingRef.current = pending;
      store('jarvis.pending', JSON.stringify(pending));
    };
    persist();
    try {
      if (!pending.conversationId) {
        const created = await api<Conversation>('/conversations', {
          client_conversation_id: pending.createId,
        });
        pending.conversationId = created.id;
        persist();
        selectedRef.current = created.id;
        setSelected(created.id);
      }
      await api<Mission>(`/conversations/${pending.conversationId}/messages`, {
        client_message_id: pending.messageId,
        text,
        expected_conversation_version: pending.version,
      });
      setDraft('');
      pendingRef.current = null;
      store('jarvis.pending', null);
      await Promise.all([refreshDetail(pending.conversationId), refreshList()]);
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 409 && pending.conversationId) {
        pendingRef.current = null;
        store('jarvis.pending', null);
        await refreshDetail(pending.conversationId).catch(report);
      }
      report(reason);
    } finally {
      setSending(false);
    }
  }
  async function cancel() {
    if (!latest) return;
    try {
      await api(`/missions/${latest.id}/commands`, { command: 'cancel' });
      await refreshDetail(latest.conversation_id);
    } catch (reason) {
      report(reason);
    }
  }
  async function logout() {
    try {
      await api('/auth/logout', {});
      setSession(null);
      setCsrfToken();
      setConversations([]);
      setDetail(null);
      setDraft('');
      pendingRef.current = null;
      for (const key of ['jarvis.draft', 'jarvis.pending', 'jarvis.conversation']) store(key, null);
      setSelected(null);
    } catch (reason) {
      report(reason);
    }
  }

  if (booting)
    return (
      <div className="loading-screen">
        <Brand />
        <p>Connexion à votre espace…</p>
      </div>
    );
  if (!session)
    return (
      <div className="login-page">
        <div className="login-card">
          <Brand />
          <span className="eyebrow">VOTRE ESPACE, VOTRE ASSISTANT</span>
          <h1>Bienvenue chez vous.</h1>
          <p className="muted">
            Retrouvez vos conversations et coordonnez vos prochaines missions.
          </p>
          {bootError ? (
            <div className="notice error" role="alert">
              {bootError}
              <button onClick={() => void bootstrap()}>Réessayer</button>
            </div>
          ) : (
            <form onSubmit={login}>
              <label htmlFor="password">Mot de passe propriétaire</label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoFocus
              />
              <button className="primary login-submit" disabled={loginBusy || !online}>
                {loginBusy ? 'Connexion…' : 'Ouvrir mon espace'}
                <ChevronRight size={18} />
              </button>
            </form>
          )}
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          <div className="login-foot">
            <ShieldCheck size={16} />
            <span>Espace privé · Session de 8 heures</span>
          </div>
          <p className="login-mode">Première version · Moteur de démonstration</p>
        </div>
      </div>
    );

  return (
    <div className="app-shell">
      {menuOpen && (
        <button
          className="sidebar-backdrop"
          aria-label="Fermer le menu"
          onClick={() => setMenuOpen(false)}
        />
      )}
      <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <Brand />
          <button
            className="icon-button mobile-only"
            aria-label="Fermer le menu"
            onClick={() => setMenuOpen(false)}
          >
            <X size={20} />
          </button>
        </div>
        <button className="new-chat" onClick={newConversation} disabled={sending}>
          <Plus size={18} />
          Nouvelle conversation<span>＋</span>
        </button>
        <nav aria-label="Navigation principale">
          <button
            className={view === 'chat' ? 'nav-item selected' : 'nav-item'}
            onClick={() => {
              setView('chat');
              setMenuOpen(false);
            }}
          >
            <MessageSquare size={18} />
            Conversation
          </button>
          <button
            className={view === 'organization' ? 'nav-item selected' : 'nav-item'}
            onClick={() => {
              setView('organization');
              setMenuOpen(false);
            }}
          >
            <LayoutGrid size={18} />
            Organisation<span className="count">{catalogue.agents.length}</span>
          </button>
          <button
            className={view === 'settings' ? 'nav-item selected' : 'nav-item'}
            onClick={() => {
              setView('settings');
              setMenuOpen(false);
            }}
          >
            <Settings2 size={18} />
            Réglages
          </button>
        </nav>
        <div className="history-label">
          CONVERSATIONS<span>{conversations.length}</span>
        </div>
        <div className="history">
          {conversations.length === 0 ? (
            <p className="history-empty">Vos conversations apparaîtront ici.</p>
          ) : (
            conversations.map((item) => (
              <button
                key={item.id}
                disabled={sending}
                className={`history-item ${selected === item.id && view === 'chat' ? 'active' : ''}`}
                onClick={() => {
                  setSelected(item.id);
                  setView('chat');
                  setMenuOpen(false);
                  setError('');
                }}
              >
                <MessageSquare size={14} />
                <span>{item.title}</span>
              </button>
            ))
          )}
        </div>
        <div className="sidebar-bottom">
          <div className="environment">
            <span className="status-dot" />
            Environnement personnel
          </div>
          <div className="profile">
            <div className="avatar">R</div>
            <div>
              Propriétaire<small>Espace privé</small>
            </div>
            <button
              className="icon-button"
              title="Se déconnecter"
              aria-label="Se déconnecter"
              onClick={() => void logout()}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-only"
              aria-label="Ouvrir le menu"
              onClick={() => setMenuOpen(true)}
            >
              <Menu size={20} />
            </button>
            <span>Espace personnel</span>
            <ChevronRight size={14} />
            <strong>
              {view === 'chat'
                ? 'Conversation'
                : view === 'organization'
                  ? 'Organisation'
                  : 'Réglages'}
            </strong>
          </div>
          <span className="mode-badge">
            <span />
            Mode démonstration
          </span>
        </header>
        {!online && (
          <div className="notice offline">
            <WifiOff size={17} />
            Hors connexion. Votre brouillon est conservé ; les missions continuent sur le serveur.
          </div>
        )}
        {error && (
          <div className="notice error" role="alert">
            <span>{error}</span>
            <button
              className="icon-button"
              aria-label="Fermer l’erreur"
              onClick={() => setError('')}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {view === 'chat' ? (
          <div className="chat-layout">
            <main className="chat-main">
              <div className="conversation-heading">
                <div className="assistant-avatar">
                  <Bot size={22} />
                </div>
                <div>
                  <h1>Jarvis</h1>
                  <p>Un point de départ pour toutes vos idées.</p>
                </div>
                <span className="text-tag">ORCHESTRATEUR</span>
              </div>
              <div className="mobile-activity-container">
                {latest && (
                  <details className="mobile-activity">
                    <summary>
                      Mission {statusLabel[latest.status].toLocaleLowerCase()} · Voir les étapes
                    </summary>
                    <ol>
                      {events.map((event) => (
                        <li key={event.event_id}>{String(event.payload.message ?? event.type)}</li>
                      ))}
                    </ol>
                  </details>
                )}
              </div>
              <div className="message-scroll" aria-label="Conversation">
                {!detail?.messages.length ? (
                  <div className="welcome">
                    <div className="welcome-mark">
                      <Activity size={30} strokeWidth={1.2} />
                    </div>
                    <span className="eyebrow">PRÊT POUR LA SUITE</span>
                    <h2>
                      Qu’allons-nous
                      <br />
                      construire aujourd’hui ?
                    </h2>
                    <p>
                      Une idée, un projet, une tâche.
                      <br />
                      Commencez une conversation avec Jarvis.
                    </p>
                    <div className="suggestions">
                      {[
                        {
                          icon: Code2,
                          title: 'Préparer un projet',
                          text: 'Prépare un plan pour mon prochain projet.',
                        },
                        {
                          icon: LayoutGrid,
                          title: 'Organiser une mission',
                          text: 'Aide-moi à organiser une mission avec plusieurs agents.',
                        },
                        {
                          icon: Search,
                          title: 'Explorer une idée',
                          text: 'Aide-moi à explorer une nouvelle idée.',
                        },
                      ].map((item) => (
                        <button
                          key={item.title}
                          onClick={() => {
                            setDraft(item.text);
                            textareaRef.current?.focus();
                          }}
                        >
                          <item.icon size={19} />
                          <span>{item.title}</span>
                          <ChevronRight size={14} />
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="messages">
                    {detail.messages.map((item) => (
                      <article key={item.id} className={`message ${item.role}`}>
                        <div className="message-avatar">
                          {item.role === 'user' ? 'R' : <Bot size={18} />}
                        </div>
                        <div className="message-content">
                          <div className="message-meta">
                            <strong>{item.role === 'user' ? 'Vous' : 'Jarvis'}</strong>
                            {item.role === 'assistant' && <span>Simulation</span>}
                            <time>
                              {new Date(item.created_at).toLocaleTimeString('fr-FR', {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </time>
                          </div>
                          <p>{item.content}</p>
                        </div>
                      </article>
                    ))}
                    {active && (
                      <div className="thinking" role="status">
                        <span />
                        <span />
                        <span />
                        <p>Jarvis prépare le résultat de démonstration…</p>
                      </div>
                    )}
                  </div>
                )}
                <div ref={bottomRef} />
              </div>
              <div className="composer-area">
                <form className="composer" onSubmit={send}>
                  <textarea
                    ref={textareaRef}
                    aria-label="Votre message"
                    placeholder="Décrivez ce que vous avez en tête…"
                    value={draft}
                    maxLength={8000}
                    rows={2}
                    disabled={sending}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        void send();
                      }
                    }}
                  />
                  <div className="composer-tools">
                    <span>
                      <span className="status-dot" />
                      {active ? 'Mission en cours' : 'Jarvis · Simulation'}
                    </span>
                    <div>
                      <button
                        type="button"
                        className="icon-button"
                        disabled
                        title="La commande vocale sera disponible dans une prochaine étape"
                        aria-label="Commande vocale à venir"
                      >
                        <Mic size={18} />
                      </button>
                      {active ? (
                        <button
                          type="button"
                          className="stop-button"
                          onClick={() => void cancel()}
                          aria-label="Arrêter la mission"
                        >
                          <Square size={13} fill="currentColor" />
                          Arrêter
                        </button>
                      ) : (
                        <button
                          className="send-button"
                          aria-label="Envoyer le message"
                          disabled={
                            !draft.trim() || sending || !online || Boolean(selected && !detail)
                          }
                        >
                          <ArrowUp size={21} />
                        </button>
                      )}
                    </div>
                  </div>
                </form>
                <p className="composer-note">
                  Aucun modèle IA connecté. Vos demandes restent dans cet environnement.
                </p>
              </div>
            </main>
            <aside className="activity-panel" aria-label="Suivi de mission">
              <div className="panel-heading">
                <Activity size={16} />
                <h2>Activité</h2>
                <span>EN DIRECT</span>
              </div>
              {latest ? (
                <>
                  <div className="mission-summary">
                    <span className={`mission-status ${latest.status}`}>
                      <span className="status-dot" />
                      {statusLabel[latest.status]}
                    </span>
                    <h3>{latest.input}</h3>
                    <div className="mission-meta">
                      <span>{shortDate(latest.created_at)}</span>
                      <span>Essai {latest.attempt || 1}</span>
                    </div>
                  </div>
                  <ol className="timeline">
                    {events.map((event) => (
                      <li key={event.event_id}>
                        <span className="timeline-icon">
                          {event.type === 'mission.completed' ? <Check size={12} /> : <span />}
                        </span>
                        <div>
                          <p>{String(event.payload.message ?? event.type)}</p>
                          <time>
                            {new Date(event.occurred_at).toLocaleTimeString('fr-FR', {
                              hour: '2-digit',
                              minute: '2-digit',
                              second: '2-digit',
                            })}
                          </time>
                        </div>
                      </li>
                    ))}
                  </ol>
                  {streamState && (
                    <p className="muted stream-state" role="status">
                      {streamState}
                    </p>
                  )}
                </>
              ) : (
                <div className="activity-empty">
                  <Clock3 size={27} strokeWidth={1.2} />
                  <h3>Tout commence ici.</h3>
                  <p>Suivez les étapes de votre prochaine mission, au fil de son avancement.</p>
                </div>
              )}
              <div className="activity-info">
                <ShieldCheck size={18} />
                <div>
                  <strong>Vous gardez la main.</strong>
                  <p>Les missions peuvent être arrêtées à tout moment.</p>
                </div>
              </div>
            </aside>
          </div>
        ) : view === 'organization' ? (
          <main className="page-content">
            <span className="eyebrow">LES COMPÉTENCES DE VOTRE ESPACE</span>
            <h1>Une équipe, un orchestrateur.</h1>
            <p className="page-intro">
              Les profils initiaux de Jarvis, organisés par domaine. Les agents spécialisés seront
              activés après connexion des harnesses.
            </p>
            <div className="department-grid">
              {catalogue.departments.map((dept) => (
                <section className="department-card" key={dept.id}>
                  <div className="department-title">
                    <LayoutGrid size={18} />
                    <h2>{dept.name}</h2>
                  </div>
                  <p>{dept.description}</p>
                  {catalogue.agents
                    .filter((agent) => agent.department_id === dept.id)
                    .map((agent) => (
                      <div className="agent-card" key={agent.id}>
                        <div className="agent-card-head">
                          <Bot size={19} />
                          <strong>{agent.name}</strong>
                          <span className="text-tag">
                            {agent.status === 'simulated' ? 'SIMULATION' : 'PRÉVU'}
                          </span>
                        </div>
                        <p>{agent.description}</p>
                        <div className="agent-engine">
                          Harness prévu <span>{agent.preferred_harness}</span>
                        </div>
                      </div>
                    ))}
                </section>
              ))}
            </div>
          </main>
        ) : (
          <main className="page-content settings">
            <span className="eyebrow">CONFIGURATION DE CETTE VERSION</span>
            <h1>Un socle pour votre Jarvis.</h1>
            <p className="page-intro">
              Le parcours de conversation est opérationnel avec un moteur de démonstration. Les
              connexions IA seront ajoutées après qualification des comptes.
            </p>
            <section className="settings-card">
              <h2>
                <FlaskConical size={20} />
                Moteur d’exécution
              </h2>
              <dl>
                <div>
                  <dt>Mode actif</dt>
                  <dd>Simulation déterministe</dd>
                </div>
                <div>
                  <dt>Appels à des modèles IA</dt>
                  <dd>Aucun</dd>
                </div>
                <div>
                  <dt>Exécution de commandes</dt>
                  <dd>Désactivée</dd>
                </div>
                <div>
                  <dt>Conversations et missions</dt>
                  <dd>Enregistrées dans PostgreSQL</dd>
                </div>
              </dl>
            </section>
            <section className="settings-card">
              <h2>
                <ShieldCheck size={20} />
                Accès à votre espace
              </h2>
              <p>
                Connexion propriétaire, session de 8 heures et protection des actions par jeton de
                session.
              </p>
              <button className="secondary" onClick={() => void logout()}>
                Se déconnecter
                <LogOut size={16} />
              </button>
            </section>
            <p className="muted">Version 0.1 · Fondations</p>
          </main>
        )}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
if (import.meta.env.PROD && 'serviceWorker' in navigator)
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
