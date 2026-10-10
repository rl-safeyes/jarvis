/** First executable subset of specs/examples/harness-adapter.ts. */
export interface HarnessInput {
  runId: string;
  prompt: string;
  signal: AbortSignal;
}
export type HarnessEvent = { type: 'progress'; message: string } | { type: 'result'; text: string };
export interface HarnessAdapter {
  readonly name: string;
  readonly simulated: boolean;
  execute(input: HarnessInput): AsyncIterable<HarnessEvent>;
}
