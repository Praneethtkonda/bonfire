import type { TokenUsage } from '../agent/index.js';

export type Line =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'tool'; name: string; args: unknown }
  | { kind: 'tool-result'; name: string; result: unknown }
  | { kind: 'error'; text: string };

export interface UsageTotals {
  input: number;
  output: number;
  turns: number;
}

export interface CodemapProgress {
  done: number;
  total: number;
  path: string;
}

export type { TokenUsage };

export function assertNever(x: never): never {
  throw new Error(`Unexpected variant: ${JSON.stringify(x)}`);
}
