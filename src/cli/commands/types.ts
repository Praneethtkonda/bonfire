import type { Line, CodemapProgress } from '../types.js';
import type { Session } from '../../session/index.js';

export interface CommandContext {
  cwd: string;
  providerLabel: string;
  currentSession: Session | null;
  setCurrentSession: (s: Session | null) => void;
  setHistory: (h: import('ai').ModelMessage[]) => void;
  appendLines: (...lines: Line[]) => void;
  setBusy: (b: boolean) => void;
  setCodemapProgress: (p: CodemapProgress | null) => void;
  /**
   * Register (or clear with `null`) an abort callback for a long-running
   * command. The Esc handler in App.tsx invokes the registered callback so
   * background work — e.g. an in-flight `/codemap build` — actually stops
   * instead of just clearing the busy flag.
   */
  registerAbort: (abort: (() => void) | null) => void;
  enterReconfigure: () => void;
  exit: () => void;
}

export interface SlashCommand {
  /** Trigger string shown in autocomplete (e.g. "/help"). */
  trigger: string;
  /** One-line description shown in /help and autocomplete. */
  description: string;
  /** Usage signature, e.g. "/sessions load <id>". */
  usage?: string;
  /** Subcommand triggers shown in autocomplete after the space. */
  subcommands?: Array<{ name: string; description: string }>;
  match: (input: string) => boolean;
  run: (ctx: CommandContext, input: string) => Promise<void>;
}
