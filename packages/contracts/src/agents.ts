import { z } from 'zod';

export const createAgentSchema = z
  .object({
    name: z.string().trim().min(2).max(70),
    department: z.string().trim().min(2).max(60),
    description: z.string().trim().min(1).max(500),
    instructions: z.string().trim().min(10).max(12000),
    profile_id: z.uuid().nullable().default(null),
  })
  .strict();
export const createAgentRequestSchema = createAgentSchema.extend({ request_id: z.uuid() });
export type CreateAgent = z.infer<typeof createAgentSchema>;
export const decisionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('reply'), text: z.string().trim().min(1).max(32000) }).strict(),
  z.object({ type: z.literal('create_agent'), agent: createAgentSchema }).strict(),
  z
    .object({
      type: z.literal('delegate'),
      agent_id: z.string().regex(/^[a-z][a-z0-9.-]{0,100}$/),
      task: z.string().trim().min(1).max(12000),
    })
    .strict(),
]);
export type Decision = z.infer<typeof decisionSchema>;
export function parseDecision(text: string): Decision {
  const source = text
    .trim()
    .replace(/^```(?:json)?\s*\n?/, '')
    .replace(/\n?```$/, '')
    .trim();
  // Compatibility for ordinary conversation; unstructured text can never execute an action.
  if (!source.startsWith('{') && !source.startsWith('['))
    return decisionSchema.parse({ type: 'reply', text: source });
  return decisionSchema.parse(JSON.parse(source));
}
export const missionLimits = {
  modelCalls: 8,
  rounds: 6,
  delegations: 3,
  creations: 3,
  durationMs: 15 * 60000,
  stepMs: 5 * 60000,
} as const;
export interface AgentTask {
  id: string;
  mission_id: string;
  sequence: number;
  kind: 'orchestrator' | 'delegate' | 'create_agent';
  agent_id: string;
  agent_name: string;
  agent_revision: number | null;
  harness: string | null;
  model: string | null;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  result: string | null;
  error: string | null;
}
