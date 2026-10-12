import { transaction, type Pool } from '@jarvis/storage';
import { setTimeout as sleep } from 'node:timers/promises';
import { githubErrors } from '../api/src/github-errors.ts';
export async function publishGitHubChange(
  pool: Pool,
  supervisor: { call(input: Record<string, unknown>): Promise<any> },
  id: string,
  changeId: string,
  pulse: () => void,
  pollMs = 1000,
) {
  const publication = (
    await pool.query('SELECT * FROM github_publications WHERE change_id=$1', [changeId])
  ).rows[0];
  if (!publication || publication.operation_id !== id) {
    await pool.query("UPDATE harness_operations SET state='cancelled' WHERE id=$1", [id]);
    return;
  }
  if (publication.state === 'succeeded') {
    await pool.query("UPDATE harness_operations SET state='succeeded',result=$2 WHERE id=$1", [
      id,
      publication.result,
    ]);
    return;
  }
  await pool.query(
    "UPDATE github_publications SET state='running',error=NULL,updated_at=now() WHERE change_id=$1",
    [changeId],
  );
  const deadline = Date.now() + 15 * 60000;
  while (true) {
    pulse();
    const result = await supervisor.call(publication.payload);
    if (['succeeded', 'failed'].includes(result.state)) {
      const error =
        result.state === 'failed'
          ? (githubErrors[result.error_code] ?? githubErrors.github_unavailable)
          : null;
      await transaction(pool, async (c) => {
        await c.query(
          'UPDATE github_publications SET state=$2,result=$3,error=$4,updated_at=now() WHERE change_id=$1 AND operation_id=$5',
          [changeId, result.state, result.result ?? null, error, id],
        );
        await c.query(
          'UPDATE harness_operations SET state=$2,result=$3,error=$4,updated_at=now() WHERE id=$1',
          [id, result.state, result.result ?? null, error],
        );
      });
      return;
    }
    if (Date.now() > deadline) throw new Error('github_timeout');
    await sleep(pollMs);
  }
}
