import { z } from 'zod';
export const harnessId = z.enum(['codex', 'claude-code', 'opencode']);
export type HarnessId = z.infer<typeof harnessId>;
export const profileSchema = z
  .object({
    id: z.uuid(),
    name: z.string().trim().min(1).max(80),
    account_id: z.uuid(),
    model: z
      .string()
      .trim()
      .min(1)
      .max(150)
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9/._:-]*$/),
  })
  .strict();
export const accountSchema = z
  .object({ id: z.uuid(), name: z.string().trim().min(1).max(80), harness: harnessId })
  .strict();
export const selectionSchema = z
  .object({ profile_id: z.uuid().nullable(), expected_revision: z.number().int().nonnegative() })
  .strict();
export const agentConfigSchema = selectionSchema.extend({
  instructions: z.string().trim().min(1).max(20000),
});
export const connectSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('device') }).strict(),
  z
    .object({
      method: z.literal('api_key'),
      secret: z.string().trim().min(10).max(8192),
      provider: z.enum(['openai', 'anthropic']).optional(),
    })
    .strict(),
]);
export interface RuntimeSnapshot {
  profile_id: string;
  account_id: string;
  account_revision: number;
  model: string;
  harness: HarnessId;
  harness_version: string;
  image_digest: string;
  source: 'default' | 'agent';
  default_revision: number | null;
  agent_id: string;
  agent_revision: number;
  instructions: string;
}
export interface HarnessDashboard {
  harnesses: {
    id: HarnessId;
    name: string;
    version: string;
    state: string;
    error: string | null;
    auth_methods: string[];
  }[];
  accounts: { id: string; name: string; harness: HarnessId; state: string; revision: number }[];
  profiles: {
    id: string;
    name: string;
    account_id: string;
    model: string;
    state: string;
    harness: HarnessId;
  }[];
  settings: { default_profile_id: string | null; revision: number };
  agents: {
    id: string;
    instructions: string;
    profile_id: string | null;
    revision: number;
    effective_profile_id: string | null;
  }[];
  operations: {
    id: string;
    kind: string;
    state: string;
    error: string | null;
    result: Record<string, unknown> | null;
  }[];
}
