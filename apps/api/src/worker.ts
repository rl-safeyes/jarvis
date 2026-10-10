import { setTimeout as sleep } from 'node:timers/promises';
import type { HarnessAdapter } from '@jarvis/harness-core';
import type { Repository } from '@jarvis/storage';

/** Temporary worker for the side-effect-free simulator. Live harnesses require Temporal. */
export class SimulationWorker {
  private stopping = false;
  private active?: AbortController;
  private loop?: Promise<void>;
  constructor(
    private repo: Repository,
    private harness: HarnessAdapter,
    private reportError: (error: unknown) => void = console.error,
  ) {
    if (!harness.simulated)
      throw new Error('Ce worker accepte uniquement les simulations sans effets de bord.');
  }
  start(): void {
    this.loop ??= this.run();
  }
  async stop(): Promise<void> {
    this.stopping = true;
    this.active?.abort();
    await this.loop;
  }
  private async run(): Promise<void> {
    while (!this.stopping) {
      try {
        await this.tick();
      } catch (error) {
        this.reportError(error);
      }
      if (!this.stopping) await sleep(200);
    }
  }
  private async tick(): Promise<void> {
    const claim = await this.repo.claimNext();
    if (!claim) return;
    if (this.stopping) {
      await this.repo.release(claim);
      return;
    }
    const abort = new AbortController();
    this.active = abort;
    let renewing = false;
    const heartbeat = setInterval(async () => {
      if (renewing) return;
      renewing = true;
      try {
        if (!(await this.repo.renew(claim))) abort.abort();
      } catch {
        abort.abort();
      } finally {
        renewing = false;
      }
    }, 250);
    const deadline = setTimeout(() => abort.abort(), 30_000);
    let completed = false;
    try {
      for await (const event of this.harness.execute({
        runId: claim.mission.id,
        prompt: claim.mission.input,
        signal: abort.signal,
      })) {
        if (abort.signal.aborted) break;
        if (event.type === 'progress') {
          if (!(await this.repo.recordProgress(claim, event.message))) {
            abort.abort();
            break;
          }
        } else {
          completed = await this.repo.finish(claim, event.text);
          break;
        }
      }
      if (!completed && !this.stopping) await this.repo.fail(claim);
    } catch (error) {
      if (!abort.signal.aborted) this.reportError(error);
      if (!this.stopping) await this.repo.fail(claim);
    } finally {
      clearInterval(heartbeat);
      clearTimeout(deadline);
      if (this.stopping) await this.repo.release(claim);
      this.active = undefined;
    }
  }
}
