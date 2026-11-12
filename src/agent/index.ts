import { streamText, stepCountIs, type ModelMessage, type ToolSet } from 'ai';
import { tools as builtinTools, describeBuiltins, type ToolDescriptor } from '../tools/index.js';
import { loadMcpServers, type LoadedMcp } from '../mcp/index.js';
import { getProvider, describeProvider, resetProvider } from './provider.js';
import { normalizePart, type AgentEvent, type TokenUsage } from './stream.js';
import { buildSystemPrompt } from './system-prompt.js';
import { formatProviderError } from './error-format.js';
import {
  autoCompact,
  clearForStep,
  estimateTokens,
  estimateHistoryTokens,
  getContextSettings,
  promptOverhead,
  recordActualTokens,
  type ContextStatus,
} from './context.js';
import { withRetry } from './retry.js';
import { isMemoryEnabled } from '../memory/index.js';
import { modelSummariser, withSummary } from './summary.js';
import { isLooping, LOOP_NOTICE } from './loop-guard.js';
import { setToolOutputBudget, withOutputCap } from '../tools/truncate.js';

export type { AgentEvent, TokenUsage };
export type { ToolDescriptor };
export type { ContextStatus };
export { describeProvider, resetProvider };
export {
  compactHistory,
  contextStatus,
  estimateHistoryTokens,
  estimateTokens,
  getContextSettings,
} from './context.js';
export { modelSummariser, withSummary } from './summary.js';
export { getProvider } from './provider.js';

const MAX_STEPS = 100;
/** Tool calls in one step that may run at once. Approval prompts still queue. */
const TOOL_CALL_CONCURRENCY = 4;
/** Retries when the stream fails after it has started. */
const STREAM_RETRIES = 2;

let mcpState: LoadedMcp | null = null;

export async function initMcp(): Promise<number> {
  mcpState = await loadMcpServers();
  return Object.keys(mcpState.tools).length;
}

export async function shutdownMcp(): Promise<void> {
  if (mcpState) await mcpState.close();
}

/** Tools currently exposed to the model (built-in + MCP) with descriptions. */
export function listTools(): ToolDescriptor[] {
  const disableBuiltins = process.env.BONFIRE_DISABLE_BUILTINS === '1';
  const builtins = disableBuiltins
    ? []
    : describeBuiltins().filter((t) => t.name !== 'memory' || isMemoryEnabled());
  const mcp: ToolDescriptor[] = Object.keys(mcpState?.tools ?? {}).map((name) => ({
    name,
    description: '',
    source: 'mcp',
  }));
  return [...builtins, ...mcp];
}

export async function* runAgent(
  history: ModelMessage[],
  userInput: string,
  options?: { signal?: AbortSignal },
): AsyncGenerator<AgentEvent> {
  let streamErrored = false;

  try {
    const provider = await getProvider();
    const system = await buildSystemPrompt();
    const systemTokens = estimateTokens(system);
    const settings = await getContextSettings();
    setToolOutputBudget(settings.maxTokens);

    // Compact *before* appending the new input so the user's own message is
    // never the thing that gets dropped. Dropped turns are summarised by the
    // model, always keeping the first request verbatim.
    const compaction = await withSummary(
      autoCompact(history, settings, systemTokens),
      settings.summarize !== false ? modelSummariser(provider.model, settings.maxTokens) : null,
      options?.signal,
    );
    if (compaction.changed) {
      yield {
        type: 'compaction',
        compaction: {
          droppedMessages: compaction.droppedMessages,
          trimmedToolOutputs: compaction.trimmedToolOutputs,
          tokensBefore: compaction.tokensBefore,
          tokensAfter: compaction.tokensAfter,
          summarised: compaction.summarised,
        },
      };
    }

    const messages: ModelMessage[] = [
      ...compaction.messages,
      { role: 'user', content: userInput },
    ];

    const used = estimateHistoryTokens(messages) + systemTokens + promptOverhead();
    yield {
      type: 'context',
      context: {
        used,
        max: settings.maxTokens,
        ratio: settings.maxTokens > 0 ? used / settings.maxTokens : 0,
      },
    };

    const disableBuiltins = process.env.BONFIRE_DISABLE_BUILTINS === '1';
    const mergedTools: Record<string, unknown> = {};
    if (!disableBuiltins) {
      for (const [name, t] of Object.entries(builtinTools)) {
        if (name === 'memory' && !isMemoryEnabled()) continue;
        mergedTools[name] = withOutputCap(t, false);
      }
    }
    for (const [name, t] of Object.entries(mcpState?.tools ?? {})) {
      mergedTools[name] = withOutputCap(t, true);
    }

    let looped = false;
    let lastEstimate = 0;

    // Only the initial connection is retried. Once tokens are streaming a
    // retry would replay text the user has already seen.
    const result = await withRetry(
      async () =>
        streamText({
          model: provider.model,
          system,
          messages,
          tools: mergedTools as ToolSet,
          stopWhen: [stepCountIs(MAX_STEPS), ({ steps }) => (looped = looped || isLooping(steps))],
          temperature: 0.2,
          streamRetries: STREAM_RETRIES,
          toolCallConcurrency: TOOL_CALL_CONCURRENCY,
          abortSignal: options?.signal,
          // Clear old tool output between steps once the window fills up.
          prepareStep: ({ messages: stepMessages }) => {
            const cleared = clearForStep(stepMessages, settings, systemTokens);
            lastEstimate = estimateHistoryTokens(cleared ?? stepMessages) + systemTokens;
            return cleared ? { messages: cleared } : undefined;
          },
          onStepFinish: ({ usage }) => {
            if (usage?.inputTokens) recordActualTokens(lastEstimate, usage.inputTokens);
          },
          // Suppress the AI SDK's default console.error of the full stack. The
          // user-facing message comes from the `error` event on `fullStream`,
          // which we route through formatProviderError below. Keep the raw error
          // available when BONFIRE_DEBUG=1 for diagnostics.
          onError: ({ error }) => {
            streamErrored = true;
            if (process.env.BONFIRE_DEBUG === '1') {
              console.error('[bonfire] streamText error:', error);
            }
          },
        }),
      {
        signal: options?.signal,
        onRetry: (attempt, delay) => {
          if (process.env.BONFIRE_DEBUG === '1') {
            console.error(`[bonfire] retrying provider call #${attempt} in ${delay}ms`);
          }
        },
      },
    );

    for await (const part of result.fullStream) {
      if (options?.signal?.aborted) break;
      const ev = normalizePart(part as Parameters<typeof normalizePart>[0]);
      if (ev) {
        if (ev.type === 'error') streamErrored = true;
        yield ev;
      }
    }

    if (looped) yield { type: 'notice', text: LOOP_NOTICE };

    // If the stream already produced an error event, awaiting `result.response`
    // would reject with NoOutputGeneratedError and we'd surface a second,
    // less-helpful message. Skip the response read in that case.
    if (!streamErrored) {
      const finalMessages = (await result.response).messages;
      yield { type: 'done', result: [...messages, ...finalMessages] };
    }
  } catch (e: unknown) {
    yield { type: 'error', error: formatProviderError(e) };
  }
}
