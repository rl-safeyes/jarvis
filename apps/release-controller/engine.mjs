// Durable state machine. Effects are idempotent and performed by an independent controller.
export async function advance(job, io) {
  const save = async (state, fields = {}) => {
    job = await io.save(job.id, state, fields);
    return job;
  };
  try {
    if (job.state === 'preparing') {
      await io.check(job);
      const artifact = await io.prepare(job);
      await save('awaiting_approval', { artifact });
      return;
    }
    if (job.state === 'awaiting_approval') {
      if (job.automatic && (await io.autoAllowed(job))) {
        await io.check(job);
        await save('queued', { approved_at: new Date().toISOString() });
      }
      return;
    }
    if (job.state === 'queued') {
      await io.check(job);
      await io.assertTarget(job);
      await save('merging');
    }
    if (job.state === 'merging') {
      // A lost response is reconciled by GitHub's journal before any repeated effect.
      await io.merge(job);
      await save('deploying');
    }
    if (job.state === 'deploying') {
      await io.maintenance(true);
      await io.promote(job);
      await save('monitoring', { monitor_until: new Date(io.now() + 900000).toISOString() });
      await io.maintenance(false);
    }
    if (job.state === 'monitoring') {
      await io.healthy(job);
      if (io.now() >= new Date(job.monitor_until).getTime()) await save('succeeded');
      await io.maintenance(false);
      return;
    }
    if (job.state === 'rollback_pending') {
      await io.maintenance(true);
      await io.rollback(job);
      await save('rolled_back');
      await io.maintenance(false);
    }
  } catch (error) {
    if (error.message === 'release_lock_lost') throw error;
    const message = io.safeError(error);
    if (['deploying', 'monitoring', 'rollback_pending'].includes(job.state)) {
      await save('rollback_pending', { error: message });
      try {
        await io.maintenance(true);
        await io.rollback(job);
        await save('rolled_back', { error: message });
        await io.maintenance(false);
      } catch {
        await save('rollback_failed', {
          error:
            'Le retour arrière nécessite une intervention opérateur. Le contrôleur conserve les deux versions.',
        });
      }
    } else if (job.state === 'merging') {
      // Merge might have succeeded remotely: keep the same immutable intent for reconciliation.
      if (error.terminal) await save('merge_unknown', { error: message });
      else if (
        [
          'github_release_stale',
          'github_release_scope',
          'github_release_protected',
          'github_release_conflict',
          'release_auto_denied',
        ].includes(error.code ?? error.message)
      )
        await save('blocked', { error: message });
      else await io.note(job.id, message);
      return;
    } else await save('blocked', { error: message });
  }
}
