import { setTimeout } from 'node:timers/promises';
import type { HarnessAdapter, HarnessEvent, HarnessInput } from '@jarvis/harness-core';

/** Deterministic and side-effect free; never invokes a model, tool or shell. */
export class MockHarness implements HarnessAdapter {
  readonly name = 'mock';
  readonly simulated = true;
  constructor(private readonly delayMs = 600) {}
  async *execute({ prompt, signal }: HarnessInput): AsyncIterable<HarnessEvent> {
    for (const message of [
      'Demande enregistrée.',
      'Vérification du parcours de mission.',
      'Préparation du résultat de démonstration.',
    ]) {
      signal.throwIfAborted();
      yield { type: 'progress', message };
      await setTimeout(this.delayMs, undefined, { signal });
    }
    yield {
      type: 'result',
      text: `Votre demande « ${prompt} » a bien parcouru le système.\n\nCette réponse est une simulation : aucun modèle IA ni outil externe n’a été appelé. La conversation et les étapes de cette mission sont enregistrées. Vous pouvez les retrouver après avoir rechargé la page.\n\nProchaine étape : connecter un harness qualifié pour réaliser réellement vos demandes.`,
    };
  }
}
