import { streamText, stepCountIs, type ModelMessage } from 'ai';
import { tools as builtinTools, describeBuiltins, type ToolDescriptor } from '../tools/index.js';
import { loadMcpServers, type LoadedMcp } from '../mcp/index.js';
import { getProvider, describeProvider, resetProvider } from './provider.js';
import { normalizePart, type AgentEvent, type TokenUsage } from './stream.js';
import { buildSystemPrompt } from './system-prompt.js';
import { formatProviderError } from './error-format.js';

export type { AgentEvent, TokenUsage };
export type { ToolDescriptor };
export { describeProvider, resetProvider };

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
  const builtins = disableBuiltins ? [] : describeBuiltins();
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
  const messages: ModelMessage[] = [...history, { role: 'user', content: userInput }];

  let streamErrored = false;

  try {
    const provider = await getProvider();
    const disableBuiltins = process.env.BONFIRE_DISABLE_BUILTINS === '1';
    const mergedTools = {
      ...(disableBuiltins ? {} : builtinTools),
      ...(mcpState?.tools ?? {}),
    };
    const result = streamText({
      model: provider.model,
      system: await buildSystemPrompt(),
      messages,
      tools: mergedTools,
      stopWhen: stepCountIs(100),
      temperature: 0.2,
      abortSignal: options?.signal,
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
    });

    for await (const part of result.fullStream) {
      if (options?.signal?.aborted) break;
      const ev = normalizePart(part as Parameters<typeof normalizePart>[0]);
      if (ev) {
        if (ev.type === 'error') streamErrored = true;
        yield ev;
      }
    }

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
