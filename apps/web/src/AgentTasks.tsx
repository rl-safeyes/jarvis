import type { AgentTask } from '../../../packages/contracts/src/agents.ts';
const labels = {
  queued: 'En attente',
  running: 'En cours',
  succeeded: 'Terminée',
  failed: 'Échec',
  cancelled: 'Arrêtée',
};
export function AgentTasks({ tasks }: { tasks: AgentTask[] }) {
  if (!tasks.length) return null;
  return (
    <section className="agent-tasks" aria-label="Tâches des agents">
      <h3>Tâches des agents</h3>
      {tasks.map((task) => (
        <details key={task.id} className="agent-task">
          <summary>
            <strong>
              {task.kind === 'create_agent' ? `Création de ${task.agent_name}` : task.agent_name}
            </strong>{' '}
            · {labels[task.status]}
          </summary>
          {task.harness && (
            <p>
              {task.harness} · {task.model} · Version {(task.agent_revision ?? 0) + 1}
            </p>
          )}
          {task.kind === 'delegate' && task.result && (
            <p className="preserved-text">{task.result}</p>
          )}
          {task.error && <p className="notice error">{task.error}</p>}
        </details>
      ))}
    </section>
  );
}
