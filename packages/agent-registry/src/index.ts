import type { AgentDefinition, Department } from '@jarvis/contracts';

export const departments: readonly Department[] = [
  {
    id: 'direction',
    name: 'Direction',
    description: 'Comprendre vos demandes et coordonner les missions.',
  },
  {
    id: 'engineering',
    name: 'Ingénierie',
    description: 'Concevoir et développer de nouvelles capacités.',
  },
  {
    id: 'quality',
    name: 'Qualité',
    description: 'Vérifier les résultats et prévenir les régressions.',
  },
  {
    id: 'knowledge',
    name: 'Connaissance',
    description: 'Organiser les sources et les connaissances.',
  },
];
export const agents: readonly AgentDefinition[] = [
  {
    id: 'direction.jarvis',
    name: 'Jarvis',
    department_id: 'direction',
    description: 'Votre point de contact pour chaque mission.',
    preferred_harness: 'codex',
    status: 'simulated',
    tools: [],
  },
  {
    id: 'engineering.developer',
    name: 'Développeur',
    department_id: 'engineering',
    description: 'Implémentation d’extensions dans un espace isolé.',
    preferred_harness: 'codex',
    status: 'planned',
    tools: ['workspace.read', 'workspace.patch', 'tests.run'],
  },
  {
    id: 'quality.reviewer',
    name: 'Reviewer',
    department_id: 'quality',
    description: 'Lecture indépendante des changements et des preuves.',
    preferred_harness: 'claude-code',
    status: 'planned',
    tools: ['workspace.read'],
  },
  {
    id: 'knowledge.researcher',
    name: 'Documentaliste',
    department_id: 'knowledge',
    description: 'Recherche, synthèse et traçabilité des informations.',
    preferred_harness: 'opencode',
    status: 'planned',
    tools: ['documents.read'],
  },
];
