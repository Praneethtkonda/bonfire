import type { ModelMessage } from 'ai';
import { loadConfig } from '../config.js';

/**
 * Context-window budgeting.
 *
 * bonfire targets local models, where an 8K window is common and a long
 * session will silently blow past it — the provider either errors or, worse,
 * quietly drops the head of the prompt. Nothing here calls the model: token
 * counts are estimated and compaction is mechanical, so budgeting can never
 * itself fail or add latency. Summarising the dropped turns is a separate,
 * optional step in summary.ts.
 */

/** Characters per token. 4 is the usual rule of thumb for English + code. */
const CHARS_PER_TOKEN = 4;

/** Per-message overhead for role/formatting tokens the template adds. */
const MESSAGE_OVERHEAD_TOKENS = 4;

/** Messages at the tail that compaction will never touch. */
export const DEFAULT_KEEP_RECENT = 6;

/** Tool outputs longer than this get trimmed first when reclaiming space. */
const TOOL_OUTPUT_TRIM_THRESHOLD = 600;
const TOOL_OUTPUT_TRIM_TO = 200;

/** Tool results kept verbatim by the mid-run clear; older ones become a stub. */
export const DEFAULT_KEEP_TOOL_RESULTS = 3;

/** Share of the window at which old tool results start being cleared mid-run. */
export const CLEAR_TOOL_RESULTS_AT = 0.7;

export const CLEARED_TOOL_OUTPUT = '[output cleared to save context; re-run the tool if needed]';

/** Clearing must save at least this share of the window, so the prompt prefix the server caches isn't rewritten for a small gain. */
export const MIN_CLEAR_GAIN = 0.1;

/**
 * Tokens the server counts that the estimate misses: tool schemas, the chat
 * template, and tokenizer differences. Learned from each step's real prompt
 * token count and added to every budget check.
 */
let overhead = 0;

export function recordActualTokens(estimated: number, actual: number): void {
  if (!(estimated > 0) || !(actual > 0)) return;
  const next = Math.max(-0.5 * estimated, actual - estimated);
  overhead = overhead === 0 ? next : Math.round(overhead * 0.5 + next * 0.5);
}

export function promptOverhead(): number {
  return overhead;
}

export function resetPromptOverhead(): void {
  overhead = 0;
}

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (content === undefined || content === null) return '';
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

export function estimateMessageTokens(message: ModelMessage): number {
  return estimateTokens(contentToText(message.content)) + MESSAGE_OVERHEAD_TOKENS;
}

export function estimateHistoryTokens(messages: ModelMessage[]): number {
  let total = 0;
  for (const m of messages) total += estimateMessageTokens(m);
  return total;
}

export interface ContextSettings {
  maxTokens: number;
  compactThreshold: number;
  autoCompact: boolean;
  /** Summarise dropped turns with the model. Default: true. */
  summarize?: boolean;
}

export async function getContextSettings(): Promise<ContextSettings> {
  const cfg = (await loadConfig()).context ?? {};
  return {
    maxTokens: cfg.maxTokens ?? 8192,
    compactThreshold: cfg.compactThreshold ?? 0.75,
    autoCompact: cfg.autoCompact ?? true,
    summarize: cfg.summarize ?? true,
  };
}

export interface ContextStatus {
  used: number;
  max: number;
  /** 0–1. May exceed 1 when the history has already overflowed. */
  ratio: number;
}

export function contextStatus(
  messages: ModelMessage[],
  systemPromptTokens: number,
  maxTokens: number,
): ContextStatus {
  const used = estimateHistoryTokens(messages) + systemPromptTokens + overhead;
  return { used, max: maxTokens, ratio: maxTokens > 0 ? used / maxTokens : 0 };
}

export interface CompactionResult {
  messages: ModelMessage[];
  /** Whole messages dropped from the head. */
  droppedMessages: number;
  /** The messages that were dropped, for summarising. */
  dropped: ModelMessage[];
  /** Tool outputs shortened in place. */
  trimmedToolOutputs: number;
  tokensBefore: number;
  tokensAfter: number;
  changed: boolean;
}

interface ToolResultPart {
  type?: string;
  output?: unknown;
  [key: string]: unknown;
}

/**
 * Shorten a single tool-result part's payload, returning null when there was
 * nothing worth trimming.
 */
function trimToolPart(part: ToolResultPart): ToolResultPart | null {
  if (part?.type !== 'tool-result' || part.output === undefined) return null;
  const text = contentToText(part.output);
  if (text.length <= TOOL_OUTPUT_TRIM_THRESHOLD) return null;
  return {
    ...part,
    output: {
      type: 'text',
      value: `${text.slice(0, TOOL_OUTPUT_TRIM_TO)}\n… [${
        text.length - TOOL_OUTPUT_TRIM_TO
      } characters trimmed to reclaim context]`,
    },
  };
}

function trimMessageToolOutputs(message: ModelMessage): {
  message: ModelMessage;
  trimmed: number;
} {
  if (message.role !== 'tool' || !Array.isArray(message.content)) {
    return { message, trimmed: 0 };
  }
  let trimmed = 0;
  const content = (message.content as ToolResultPart[]).map((part) => {
    const next = trimToolPart(part);
    if (next) {
      trimmed++;
      return next;
    }
    return part;
  });
  if (trimmed === 0) return { message, trimmed: 0 };
  return { message: { ...message, content } as ModelMessage, trimmed };
}

/**
 * Bring `messages` under `targetTokens` using two mechanical passes:
 *
 *   1. Trim oversized tool outputs in the older part of the history. Tool
 *      results dominate token use and are the least valuable to keep verbatim.
 *   2. Drop whole turns from the head, always cutting at a `user` message.
 *
 * Cutting only at user-message boundaries matters: an assistant message
 * carrying tool calls must never be separated from the tool message carrying
 * their results, or the provider rejects the request for referencing an
 * unknown tool_call_id.
 */
export function compactHistory(
  messages: ModelMessage[],
  options: { targetTokens: number; keepRecent?: number },
): CompactionResult {
  const keepRecent = options.keepRecent ?? DEFAULT_KEEP_RECENT;
  const tokensBefore = estimateHistoryTokens(messages);

  if (tokensBefore <= options.targetTokens || messages.length === 0) {
    return {
      messages,
      droppedMessages: 0,
      dropped: [],
      trimmedToolOutputs: 0,
      tokensBefore,
      tokensAfter: tokensBefore,
      changed: false,
    };
  }

  // Pass 1 — trim old tool outputs.
  const protectedFrom = Math.max(0, messages.length - keepRecent);
  let trimmedToolOutputs = 0;
  let working = messages.map((m, i) => {
    if (i >= protectedFrom) return m;
    const { message, trimmed } = trimMessageToolOutputs(m);
    trimmedToolOutputs += trimmed;
    return message;
  });

  // Pass 2 — drop whole turns from the head at user-message boundaries.
  let droppedMessages = 0;
  let dropped: ModelMessage[] = [];
  if (estimateHistoryTokens(working) > options.targetTokens) {
    // Boundaries index `trimmed`, so every candidate slices that same array
    // rather than the progressively shortened result.
    const trimmed = working;
    const boundaries: number[] = [];
    for (let i = 0; i < trimmed.length; i++) {
      if (trimmed[i].role === 'user') boundaries.push(i);
    }
    for (const cut of boundaries) {
      if (cut === 0) continue; // cutting here removes nothing
      const remaining = trimmed.length - cut;
      if (remaining < Math.min(keepRecent, trimmed.length)) break;
      working = trimmed.slice(cut);
      dropped = trimmed.slice(0, cut);
      droppedMessages = cut;
      if (estimateHistoryTokens(working) <= options.targetTokens) break;
    }
  }

  const tokensAfter = estimateHistoryTokens(working);
  return {
    messages: working,
    droppedMessages,
    dropped,
    trimmedToolOutputs,
    tokensBefore,
    tokensAfter,
    changed: droppedMessages > 0 || trimmedToolOutputs > 0,
  };
}

/**
 * Compact only when the history exceeds `compactThreshold` of the window,
 * targeting half the window so compaction doesn't have to run every turn.
 */
export function autoCompact(
  messages: ModelMessage[],
  settings: ContextSettings,
  systemPromptTokens = 0,
): CompactionResult {
  systemPromptTokens += overhead;
  const used = estimateHistoryTokens(messages) + systemPromptTokens;
  const limit = settings.maxTokens * settings.compactThreshold;
  if (!settings.autoCompact || used <= limit) {
    return {
      messages,
      droppedMessages: 0,
      dropped: [],
      trimmedToolOutputs: 0,
      tokensBefore: used,
      tokensAfter: used,
      changed: false,
    };
  }
  // The floor is proportional so a small window (a 2K local model) still gets
  // a sane target instead of one larger than the window itself.
  const target = Math.max(
    Math.floor(settings.maxTokens * 0.15),
    Math.floor(settings.maxTokens * 0.5) - systemPromptTokens,
  );
  return compactHistory(messages, { targetTokens: target });
}

function isClearable(part: ToolResultPart): boolean {
  return (
    part?.type === 'tool-result' &&
    part.output !== undefined &&
    contentToText(part.output).length > CLEARED_TOOL_OUTPUT.length * 2
  );
}

/**
 * Replace the output of every tool result except the most recent
 * `keepToolResults` with a short stub. Tool calls and result ids stay, so the
 * history remains valid for the server.
 */
export function clearOldToolResults(
  messages: ModelMessage[],
  keepToolResults: number = DEFAULT_KEEP_TOOL_RESULTS,
): { messages: ModelMessage[]; cleared: number } {
  let seen = 0;
  let cleared = 0;
  const out = [...messages];
  for (let i = out.length - 1; i >= 0; i--) {
    const m = out[i];
    if (m.role !== 'tool' || !Array.isArray(m.content)) continue;
    const parts = m.content as ToolResultPart[];
    let changed = false;
    const next = [...parts];
    for (let j = parts.length - 1; j >= 0; j--) {
      if (parts[j]?.type !== 'tool-result') continue;
      if (seen++ < keepToolResults || !isClearable(parts[j])) continue;
      next[j] = { ...parts[j], output: { type: 'text', value: CLEARED_TOOL_OUTPUT } };
      changed = true;
      cleared++;
    }
    if (changed) out[i] = { ...m, content: next } as ModelMessage;
  }
  return cleared > 0 ? { messages: out, cleared } : { messages, cleared: 0 };
}

/**
 * Mid-run guard used between model steps: clear old tool results once the
 * window is 70% full. Every clear rewrites earlier messages and so throws
 * away the server's prompt cache from that point, so it only happens when it
 * frees a worthwhile share of the window, unless the window is nearly full.
 * Returns undefined when nothing needs to change.
 */
export function clearForStep(
  messages: ModelMessage[],
  settings: ContextSettings,
  systemPromptTokens = 0,
): ModelMessage[] | undefined {
  if (!settings.autoCompact) return undefined;
  systemPromptTokens += overhead;
  const used = estimateHistoryTokens(messages) + systemPromptTokens;
  if (used <= settings.maxTokens * CLEAR_TOOL_RESULTS_AT) return undefined;
  const { messages: cleared, cleared: n } = clearOldToolResults(messages);
  if (n === 0) return undefined;
  const after = estimateHistoryTokens(cleared) + systemPromptTokens;
  const nearlyFull = used > settings.maxTokens * 0.9;
  if (!nearlyFull && used - after < settings.maxTokens * MIN_CLEAR_GAIN) return undefined;
  return cleared;
}
