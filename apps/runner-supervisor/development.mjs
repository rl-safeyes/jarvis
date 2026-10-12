import { createHash } from 'node:crypto';
const uuid = (x) =>
  typeof x === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(x);
// Docker metadata is the durable journal: retries attach to the same container, never re-run a shell.
export function developmentRunner(docker, prefix) {
  const creating = new Map();
  const image = process.env.JARVIS_DEVELOPMENT_IMAGE ?? `${prefix}-development:current`;
  async function describe() {
    try {
      const i = JSON.parse(await docker(['image', 'inspect', image]))[0];
      return { available: true, image_digest: i.Id };
    } catch {
      return { available: false };
    }
  }
  async function inspect(name) {
    try {
      return JSON.parse(await docker(['inspect', name]))[0];
    } catch {
      return null;
    }
  }
  function owned(info, id, workspace) {
    if (
      info.Config.Labels?.['jarvis.owner'] !== prefix ||
      info.Config.Labels?.['jarvis.development'] !== workspace ||
      info.Config.Labels?.['jarvis.operation'] !== id
    )
      throw new Error('container_conflict');
  }
  async function dispatch(input) {
    if (input.action === 'development_status') return describe();
    if (!uuid(input.id) || !uuid(input.workspace_id)) throw new Error('invalid_id');
    const name = `${prefix}-dev-${input.id}`;
    const tombstone = await inspect(`${name}-cancelled`);
    if (tombstone) {
      owned(tombstone, input.id, input.workspace_id);
      return { state: 'cancelled' };
    }
    if (input.action === 'development_cancel') {
      const info = await inspect(name);
      if (info) {
        owned(info, input.id, input.workspace_id);
        if (info.State.Running) await docker(['kill', name]);
        await docker(['rename', name, `${name}-cancelled`]);
      } else
        await docker([
          'create',
          '--name',
          `${name}-cancelled`,
          '--label',
          `jarvis.owner=${prefix}`,
          '--label',
          `jarvis.development=${input.workspace_id}`,
          '--label',
          `jarvis.operation=${input.id}`,
          '--network',
          'none',
          image,
        ]);
      return { state: 'cancelled' };
    }
    if (
      !/^sha256:[a-f0-9]{64}$/.test(input.image_digest) ||
      !['initialize', 'list', 'read', 'write', 'remove', 'exec', 'freeze', 'validate'].includes(
        input.operation?.tool,
      )
    )
      throw new Error('invalid_operation');
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          workspace: input.workspace_id,
          image: input.image_digest,
          operation: input.operation,
        }),
      )
      .digest('hex');
    let info = await inspect(name);
    if (!info) {
      if (creating.has(name)) await creating.get(name);
      else {
        const job = (async () => {
          const running = (
            await docker([
              'ps',
              '-q',
              '--filter',
              `label=jarvis.owner=${prefix}`,
              '--filter',
              'label=jarvis.operation',
            ])
          )
            .split('\n')
            .filter(Boolean);
          if (running.length >= 2) return;
          const write = !['freeze', 'validate'].includes(input.operation.tool);
          const args = [
            'create',
            '--name',
            name,
            '--label',
            `jarvis.owner=${prefix}`,
            '--label',
            `jarvis.development=${input.workspace_id}`,
            '--label',
            `jarvis.operation=${input.id}`,
            '--label',
            `jarvis.fingerprint=${fingerprint}`,
            '--network',
            'none',
            '--init',
            '--read-only',
            '--cap-drop',
            'ALL',
            '--security-opt',
            'no-new-privileges:true',
            '--user',
            '1000:1000',
            '--cpus',
            '1',
            '--memory',
            '1g',
            '--pids-limit',
            '128',
            '--ulimit',
            'fsize=8388608:8388608',
            '--tmpfs',
            '/tmp:rw,nosuid,size=384m,mode=1777',
            '--mount',
            `type=volume,source=${prefix}-workspace-${input.workspace_id},target=/workspace${write ? '' : ',readonly'}`,
          ];
          if (['freeze', 'validate'].includes(input.operation.tool))
            args.push(
              '--mount',
              `type=volume,source=${prefix}-artifact-${input.workspace_id},target=/artifact${input.operation.tool === 'validate' ? ',readonly' : ''}`,
            );
          if (input.operation.source_id) {
            if (
              !uuid(input.operation.source_id) ||
              input.operation.source_id !== input.workspace_id
            )
              throw new Error('invalid_source');
            args.push(
              '--mount',
              `type=volume,source=${prefix}-github-sources,target=/github-sources,readonly`,
            );
          }
          args.push(
            input.image_digest,
            Buffer.from(
              JSON.stringify({ ...input.operation, change_id: input.workspace_id }),
            ).toString('base64'),
          );
          await docker(args);
          await docker(['start', name]);
        })().finally(() => creating.delete(name));
        creating.set(name, job);
        await job;
      }
      info = await inspect(name);
      if (!info) return { state: 'queued' };
    }
    owned(info, input.id, input.workspace_id);
    if (info.Config.Labels?.['jarvis.fingerprint'] !== fingerprint)
      throw new Error('operation_conflict');
    // A crash between create and start has no side effect and can safely resume.
    if (info.State.Status === 'created') {
      await docker(['start', name]);
      return { state: 'running' };
    }
    if (info.State.Running) {
      if (Date.now() - new Date(info.State.StartedAt).getTime() > 240000) {
        await docker(['kill', name]);
        return { state: 'failed', error: 'Durée maximale de l’outil dépassée.' };
      }
      return { state: 'running' };
    }
    if (info.State.ExitCode !== 0)
      return {
        state: 'failed',
        error: 'L’outil a échoué ou a été interrompu. Consultez le journal.',
        output: (await docker(['logs', name])).slice(-2000),
      };
    let output;
    try {
      output = JSON.parse(await docker(['logs', name]));
    } catch {
      return { state: 'failed', error: 'Résultat inconnu : aucun nouvel essai automatique.' };
    }
    return output.ok
      ? { state: 'succeeded', result: output.result }
      : { state: 'failed', error: output.error };
  }
  let queue = Promise.resolve();
  return (input) => {
    const result = queue.then(() => dispatch(input));
    queue = result.catch(() => {});
    return result;
  };
}
