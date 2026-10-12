import { Worker, NativeConnection } from '@temporalio/worker';
import { Client, Connection, WorkflowExecutionAlreadyStartedError } from '@temporalio/client';
import { Pool, migrate } from '@jarvis/storage';
import { HarnessRepository } from '../../packages/storage/src/harnesses.ts';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import * as activities from './activities.ts';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
await migrate(pool);
const repo = new HarnessRepository(pool);
await repo.seed();
const address = process.env.TEMPORAL_ADDRESS ?? 'temporal:7233';
const connection = await Connection.connect({ address });
const native = await NativeConnection.connect({ address });
const client = new Client({ connection });
const worker = await Worker.create({
  connection: native,
  namespace: 'default',
  taskQueue: 'jarvis-harness',
  workflowBundle: { codePath: fileURLToPath(new URL('./workflow-bundle.cjs', import.meta.url)) },
  activities,
  maxConcurrentActivityTaskExecutions: 4,
});
for (const harness of (process.env.JARVIS_INITIAL_HARNESSES ?? 'codex,claude-code')
  .split(',')
  .filter(Boolean)) {
  const h = (await pool.query('SELECT * FROM harness_installations WHERE id=$1', [harness]))
    .rows[0];
  if (!h) throw new Error('Harness initial inconnu');
  if (
    h.state === 'absent' &&
    !(
      await pool.query(
        "SELECT id FROM harness_operations WHERE kind='install' AND payload->>'harness'=$1 AND state IN ('queued','running')",
        [harness],
      )
    ).rowCount
  )
    await repo.operation(randomUUID(), 'install', { harness });
}
let stopped = false;
async function dispatch() {
  while (!stopped) {
    try {
      const ops = (
        await pool.query(
          'SELECT id FROM harness_operations WHERE dispatched=false ORDER BY created_at LIMIT 20',
        )
      ).rows;
      for (const op of ops) {
        try {
          await client.workflow.start('harnessOperation', {
            workflowId: `jarvis-${op.id}`,
            taskQueue: 'jarvis-harness',
            args: [op.id],
            workflowExecutionTimeout: '1 hour',
          });
        } catch (e) {
          if (!(e instanceof WorkflowExecutionAlreadyStartedError)) throw e;
        }
        await pool.query('UPDATE harness_operations SET dispatched=true WHERE id=$1', [op.id]);
      }
    } catch {
      console.error('Outbox temporairement indisponible ; nouvelle tentative.');
    }
    await sleep(1000);
  }
}
const loop = dispatch();
const stop = () => {
  stopped = true;
  worker.shutdown();
};
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
await worker.run();
stopped = true;
await loop;
await activities.closeActivities();
await pool.end();
await native.close();
await connection.close();
