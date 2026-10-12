import { z } from 'zod';
const path = z
  .string()
  .min(1)
  .max(240)
  .refine(
    (p) =>
      !p.startsWith('/') &&
      p
        .split('/')
        .every(
          (x) =>
            x &&
            x !== '.' &&
            x !== '..' &&
            x !== '.git' &&
            x !== 'node_modules' &&
            x !== '.env' &&
            !x.startsWith('.env.'),
        ) &&
      !/[\x00-\x1f\\]/.test(p),
    'Chemin relatif requis',
  );
export const developmentToolSchema = z.discriminatedUnion('tool', [
  z.object({ tool: z.literal('list'), path: path.optional() }).strict(),
  z
    .object({
      tool: z.literal('read'),
      path,
      offset: z.number().int().min(0).max(1000000).default(0),
    })
    .strict(),
  z.object({ tool: z.literal('write'), path, content: z.string().max(60000) }).strict(),
  z.object({ tool: z.literal('remove'), path }).strict(),
  z.object({ tool: z.literal('exec'), command: z.string().min(1).max(4000) }).strict(),
]);
export const developerDecisionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('tool'), operation: developmentToolSchema }).strict(),
  z.object({ type: z.literal('done'), summary: z.string().min(1).max(4000) }).strict(),
]);
export const reviewSchema = z
  .object({
    verdict: z.enum(['approve', 'changes_requested']),
    summary: z.string().min(1).max(8000),
  })
  .strict();
export function parseDevelopmentDecision(text: string) {
  return developerDecisionSchema.parse(
    JSON.parse(
      text
        .trim()
        .replace(/^```(?:json)?\s*/, '')
        .replace(/\s*```$/, ''),
    ),
  );
}
export type DevelopmentTool = z.infer<typeof developmentToolSchema>;
export interface DevelopmentChange {
  id: string;
  mission_id: string;
  status: string;
  task: string;
  image_digest: string;
  source?: { repository: string; branch: string; commit?: string; snapshot_id?: string } | null;
  artifact: {
    patch: string;
    digest: string;
    commit: string;
    base_commit: string;
    files: string[];
    truncated?: boolean;
  } | null;
  validation: { passed: boolean; output: string; exit_code: number } | null;
  review: { verdict: string; summary: string } | null;
  error: string | null;
}
