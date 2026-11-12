import { generateText, type LanguageModel, type ModelMessage } from 'ai';
import { estimateHistoryTokens, type CompactionResult } from './context.js';
import { headTail } from '../tools/truncate.js';

/**
 * Summary compaction. Dropping old turns frees space but forgets the task;
 * here the dropped turns are condensed by the model into a short note that is
 * prepended to the first kept user message. The user's first request is
 * always carried over verbatim, so the goal survives any number of
 * compactions. If the model call fails, the note keeps just that request.
 */

export const SUMMARY_MARKER = '[Earlier conversation, summarised to save context]';
const REQUEST_HEADING = 'Original request:';
const SUMMARY_HEADING = 'Summary:';
const END_MARKER = '[End of summary]';

const SUMMARY_TIMEOUT_MS = 60_000;
const TOOL_TEXT_MAX = 600;

const SUMMARY_SYSTEM = `You condense a coding session so the work can continue with less context.
Write plain bullet points under these headings, and nothing else:
Goal: what the user wants overall.
Decisions and facts: constraints, findings and choices that still matter.
Files: paths created, changed or read that matter, with a few words each.
Done: what has been finished.
Still to do: what remains, in order.
Fold any earlier summary into yours. Keep exact names, paths, commands and error messages. Be brief.`;

function partText(part: unknown): string {
  const p = part as {
    type?: string;
    text?: string;
    toolName?: string;
    input?: unknown;
    output?: { type?: string; value?: unknown };
  };
  switch (p?.type) {
    case 'text':
      return p.text ?? '';
    case 'tool-call':
      return `→ ${p.toolName}(${headTail(JSON.stringify(p.input ?? {}), TOOL_TEXT_MAX)})`;
    case 'tool-result': {
      const v = p.output?.value;
      const text = typeof v === 'string' ? v : JSON.stringify(v ?? p.output ?? '');
      return `← ${p.toolName}: ${headTail(text, TOOL_TEXT_MAX)}`;
    }
    default:
      return '';
  }
}

export function messageText(message: ModelMessage): string {
  const c = message.content as unknown;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map(partText).filter(Boolean).join('\n');
  return '';
}

/** The user's first request, carried over from an earlier summary if there is one. */
export function originalRequest(messages: ModelMessage[]): string | null {
  const first = messages.find((m) => m.role === 'user');
  if (!first) return null;
  const text = messageText(first);
  if (!text.startsWith(SUMMARY_MARKER)) return text;
  const start = text.indexOf(REQUEST_HEADING);
  if (start < 0) return null;
  const ends = [`\n\n${SUMMARY_HEADING}`, `\n\n${END_MARKER}`]
    .map((m) => text.indexOf(m, start))
    .filter((i) => i > start);
  return text.slice(start + REQUEST_HEADING.length, ends.length ? Math.min(...ends) : undefined).trim();
}

export function summaryBlock(request: string | null, summary: string | null): string {
  const parts = [SUMMARY_MARKER];
  if (request) parts.push(`${REQUEST_HEADING}\n${request}`);
  if (summary) parts.push(`${SUMMARY_HEADING}\n${summary.trim()}`);
  parts.push(END_MARKER);
  return parts.join('\n\n');
}

/** Put the note at the front of the first kept user message, keeping roles alternating. */
export function prependSummary(kept: ModelMessage[], block: string): ModelMessage[] {
  const [first, ...rest] = kept;
  if (!first || first.role !== 'user') return [{ role: 'user', content: block }, ...kept];
  if (typeof first.content === 'string') {
    return [{ ...first, content: `${block}\n\n${first.content}` }, ...rest];
  }
  return [
    { ...first, content: [{ type: 'text', text: block }, ...first.content] } as ModelMessage,
    ...rest,
  ];
}

export type Summariser = (transcript: string, signal?: AbortSignal) => Promise<string | null>;

/** Ask the model for the note. Returns null on any failure. */
export function modelSummariser(model: LanguageModel, maxTokens: number): Summariser {
  return async (transcript, signal) => {
    try {
      const timeout = AbortSignal.timeout(SUMMARY_TIMEOUT_MS);
      const { text } = await generateText({
        model,
        system: SUMMARY_SYSTEM,
        prompt: headTail(transcript, Math.max(8_000, Math.floor(maxTokens * 0.5 * 4)), 0.5),
        temperature: 0,
        maxRetries: 0,
        maxOutputTokens: Math.min(2_048, Math.max(256, Math.floor(maxTokens * 0.1))),
        abortSignal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      return text.trim() || null;
    } catch {
      return null;
    }
  };
}

/**
 * Replace the turns a compaction dropped with a summary note. Returns the
 * result unchanged when nothing was dropped.
 */
export async function withSummary(
  result: CompactionResult,
  summarise: Summariser | null,
  signal?: AbortSignal,
): Promise<CompactionResult & { summarised: boolean }> {
  if (result.droppedMessages === 0) return { ...result, summarised: false };
  const request = originalRequest(result.dropped);
  const transcript = result.dropped
    .map((m) => `${m.role}: ${messageText(m)}`)
    .filter((line) => line.trim().length > 0)
    .join('\n\n');
  const summary = summarise ? await summarise(transcript, signal) : null;
  const messages = prependSummary(result.messages, summaryBlock(request, summary));
  const delta = estimateHistoryTokens(messages) - estimateHistoryTokens(result.messages);
  return { ...result, messages, tokensAfter: result.tokensAfter + delta, summarised: summary !== null };
}
