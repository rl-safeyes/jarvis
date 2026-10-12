import { z } from 'zod';

export const idSchema = z.uuid();
export const createConversationSchema = z
  .object({
    client_conversation_id: idSchema,
    title: z.string().trim().min(1).max(120).default('Nouvelle conversation'),
  })
  .strict();
export const submitMessageSchema = z
  .object({
    client_message_id: idSchema,
    text: z.string().trim().min(1).max(8000),
    expected_conversation_version: z.number().int().nonnegative(),
    development: z.boolean().optional(),
  })
  .strict();
export const loginSchema = z.object({ password: z.string().min(1).max(256) }).strict();
export const commandSchema = z.object({ command: z.literal('cancel') }).strict();
export type SubmitMessage = z.infer<typeof submitMessageSchema>;
export type MissionStatus =
  'queued' | 'running' | 'cancel_requested' | 'succeeded' | 'failed' | 'cancelled';
export interface Conversation {
  id: string;
  title: string;
  version: number;
  created_at: string;
}
export interface Message {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  mission_id: string;
  created_at: string;
}
export interface Mission {
  id: string;
  conversation_id: string;
  input: string;
  status: MissionStatus;
  harness: 'control' | 'mock' | 'codex' | 'claude-code' | 'opencode';
  runtime?: import('./harnesses.ts').RuntimeSnapshot | null;
  agent_id: string;
  attempt: number;
  development_enabled?: boolean;
  result: string | null;
  created_at: string;
  updated_at: string;
}
export interface MissionEvent {
  event_id: string;
  mission_id: string;
  sequence: number;
  type: string;
  payload: Record<string, unknown>;
  occurred_at: string;
}
export interface ConversationDetail {
  conversation: Conversation;
  messages: Message[];
  missions: Mission[];
  tasks?: import('./agents.ts').AgentTask[];
  changes?: import('./development.ts').DevelopmentChange[];
}
export interface SessionInfo {
  authenticated: true;
  csrf_token: string;
  mode: 'mock' | 'live';
  expires_at: string;
}
export interface AgentDefinition {
  id: string;
  name: string;
  department_id: string;
  description: string;
  preferred_harness: 'codex' | 'claude-code' | 'opencode';
  status: 'simulated' | 'planned' | 'ready';
  revision?: number;
  instructions?: string;
  profile_id?: string | null;
  tools: readonly string[];
}
export interface Department {
  id: string;
  name: string;
  description: string;
}
export const terminalStatuses: readonly MissionStatus[] = ['succeeded', 'failed', 'cancelled'];
export function isTerminal(status: MissionStatus): boolean {
  return terminalStatuses.includes(status);
}
