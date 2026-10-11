import { Pool, Repository, migrate } from '@jarvis/storage';
import { MockHarness } from '@jarvis/harness-mock';
import { readConfig } from './config.ts';
import { createApp } from './app.ts';
import { SimulationWorker } from './worker.ts';

const config = readConfig();
const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 10,
  connectionTimeoutMillis: 5000,
});
await migrate(pool);
const repo = new Repository(pool, config.mode);
const app = await createApp({ repo, ...config, logger: true, serveWeb: true });
const worker = new SimulationWorker(repo, new MockHarness(), (error) =>
  app.log.error({ err: error }, 'Simulation worker error'),
);
await app.listen({ host: config.host, port: config.port });
if (config.mode === 'mock') worker.start();
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  await worker.stop();
  await app.close();
  await pool.end();
}
process.once('SIGTERM', () => {
  void shutdown();
});
process.once('SIGINT', () => {
  void shutdown();
});
