import type { ModelMessage } from 'ai';
import { loadConfig } from '../config.js';

/**
 * Context-window budgeting.
 *
 * bonfire targets local models, where an 8K window is common and a long
 * session will silently blow past it — the provider either errors or, worse,
 * quietly drops the head of the prompt. Nothing here calls the model: token
 * counts are estimated and compaction is mechanical, so budgeting can never
 * itself fail or add latency.
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
}

export async function getContextSettings(): Promise<ContextSettings> {
  const cfg = (await loadConfig()).context ?? {};
  return {
    maxTokens: cfg.maxTokens ?? 8192,
    compactThreshold: cfg.compactThreshold ?? 0.75,
    autoCompact: cfg.autoCompact ?? true,
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
  const used = estimateHistoryTokens(messages) + systemPromptTokens;
  return { used, max: maxTokens, ratio: maxTokens > 0 ? used / maxTokens : 0 };
}

export interface CompactionResult {
  messages: ModelMessage[];
  /** Whole messages dropped from the head. */
  droppedMessages: number;
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
      droppedMessages = cut;
      if (estimateHistoryTokens(working) <= options.targetTokens) break;
    }
  }

  const tokensAfter = estimateHistoryTokens(working);
  return {
    messages: working,
    droppedMessages,
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
  const used = estimateHistoryTokens(messages) + systemPromptTokens;
  const limit = settings.maxTokens * settings.compactThreshold;
  if (!settings.autoCompact || used <= limit) {
    return {
      messages,
      droppedMessages: 0,
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
