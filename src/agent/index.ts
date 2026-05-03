import { streamText, stepCountIs, type ModelMessage } from 'ai';
import { tools as builtinTools, describeBuiltins, type ToolDescriptor } from '../tools/index.js';
import { loadMcpServers, type LoadedMcp } from '../mcp/index.js';
import { getProvider, describeProvider, resetProvider } from './provider.js';
import { normalizePart, type AgentEvent, type TokenUsage } from './stream.js';
import { buildSystemPrompt } from './system-prompt.js';

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

function formatAgentError(e: unknown): string {
  if (e instanceof Error) {
    const msg = e.message;
    if (msg.includes('401') || msg.includes('Unauthorized')) {
      return 'Authentication failed (401). Check your API key with /config or /reconfigure.';
    }
    if (msg.includes('403') || msg.includes('Forbidden')) {
      return 'Forbidden (403). Check your API key permissions.';
    }
    if (msg.includes('429') || msg.includes('rate limit')) {
      return 'Rate limit exceeded (429). Please wait and try again.';
    }
    if (msg.includes('500')) {
      return 'Server error (500). The model service may be down.';
    }
    if (msg.includes('503') || msg.includes('unavailable')) {
      return 'Service unavailable (503). The model service may be overloaded.';
    }
    if (msg.includes('ECONNREFUSED') || msg.includes('connect')) {
      return 'Could not connect. Is the model server running?';
    }
    if (msg.includes('timeout') || msg.includes('timed out')) {
      return 'Request timed out. The model may be slow or unresponsive.';
    }
    return msg;
  }
  return String(e);
}

export async function* runAgent(
  history: ModelMessage[],
  userInput: string,
  options?: { signal?: AbortSignal },
): AsyncGenerator<AgentEvent> {
  const messages: ModelMessage[] = [...history, { role: 'user', content: userInput }];

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
    });

    for await (const part of result.fullStream) {
      if (options?.signal?.aborted) break;
      const ev = normalizePart(part as Parameters<typeof normalizePart>[0]);
      if (ev) yield ev;
    }

    const finalMessages = (await result.response).messages;
    yield { type: 'done', result: [...messages, ...finalMessages] };
  } catch (e: unknown) {
    yield { type: 'error', error: formatAgentError(e) };
  }
}
