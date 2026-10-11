import { bundleWorkflowCode } from '@temporalio/worker';
import { writeFile } from 'node:fs/promises';
const bundle = await bundleWorkflowCode({
  workflowsPath: new URL('../apps/workflow-worker/workflows.ts', import.meta.url).pathname,
});
await writeFile(
  new URL('../apps/workflow-worker/workflow-bundle.cjs', import.meta.url),
  bundle.code,
);
