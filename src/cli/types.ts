import type { TokenUsage } from '../agent/index.js';

export type Line =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'notice'; text: string }
  /**
   * A tool call. The live stream holds a call until its result arrives and
   * then commits call and result together, so the scrollback shows each call
   * with its outcome (and a finished bullet colour) on adjacent lines.
   */
  | {
      kind: 'tool';
      name: string;
      args: unknown;
      /** Absent for a call that never finished (or a caller that has no result). */
      result?: unknown;
      /** The call was cut short by the user. */
      interrupted?: boolean;
      durationMs?: number;
      /** The approved diff for a write or edit, when one was shown. */
      diff?: string;
    }
  | { kind: 'tool-result'; name: string; result: unknown }
  | { kind: 'error'; text: string }
  /** The user pressed esc mid-turn. */
  | { kind: 'interrupted' }
  /** End-of-turn line: how long the turn took. */
  | { kind: 'turn-summary'; seconds: number; outputTokens: number };

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
