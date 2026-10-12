import { proxyActivities } from '@temporalio/workflow';
import type { executeOperation } from './activities.ts';
const activities = proxyActivities<{ executeOperation: typeof executeOperation }>({
  startToCloseTimeout: '35 minutes',
  heartbeatTimeout: '30 seconds',
  retry: { maximumAttempts: 3, initialInterval: '3 seconds', maximumInterval: '30 seconds' },
});
export async function harnessOperation(id: string): Promise<void> {
  await activities.executeOperation(id);
}
