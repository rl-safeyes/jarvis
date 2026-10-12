import { z } from 'zod';
const schema = z.object({
  WHISPER_URL: z.string().url().optional(),
  STT_MODEL: z
    .string()
    .regex(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/)
    .default('Systran/faster-whisper-small'),
  DATABASE_URL: z.string().url(),
  JARVIS_OWNER_PASSWORD: z.string().min(20).max(256),
  APP_ORIGIN: z.string().url().default('http://localhost:5173'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HARNESS_MODE: z.enum(['mock', 'live']).default('live'),
  JARVIS_SUPERVISOR_URL: z.string().url().default('http://supervisor:7080'),
  JARVIS_SUPERVISOR_TOKEN: z.string().optional(),
});
export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = schema.safeParse(env);
  if (!parsed.success)
    throw new Error(
      `Configuration invalide : ${parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')}. Consultez .env.example.`,
    );
  const value = parsed.data;
  const url = new URL(value.APP_ORIGIN);
  if (url.origin !== value.APP_ORIGIN || !['http:', 'https:'].includes(url.protocol))
    throw new Error('APP_ORIGIN doit être une origine HTTP(S), sans chemin ni slash final.');
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    throw new Error('HTTPS est requis hors de localhost.');
  if (value.JARVIS_OWNER_PASSWORD.includes('replace-'))
    throw new Error('Générez une configuration avec npm run setup avant de démarrer.');
  if (value.HARNESS_MODE === 'live' && (value.JARVIS_SUPERVISOR_TOKEN?.length ?? 0) < 32)
    throw new Error('Exécutez npm run setup pour générer le secret du superviseur.');
  return {
    voice: value.WHISPER_URL ? { url: value.WHISPER_URL, model: value.STT_MODEL } : undefined,
    mode: value.HARNESS_MODE,
    supervisorUrl: value.JARVIS_SUPERVISOR_URL,
    supervisorToken: value.JARVIS_SUPERVISOR_TOKEN ?? '',
    databaseUrl: value.DATABASE_URL,
    password: value.JARVIS_OWNER_PASSWORD,
    origin: value.APP_ORIGIN,
    host: value.HOST,
    port: value.PORT,
    secureCookie: url.protocol === 'https:',
  };
}
