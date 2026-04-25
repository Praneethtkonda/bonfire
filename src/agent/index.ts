import { streamText, stepCountIs, type ModelMessage } from 'ai';
import { tools as builtinTools, describeBuiltins, type ToolDescriptor } from '../tools/index.js';
import { loadMcpServers, type LoadedMcp } from '../mcp/index.js';
import { getProvider, describeProvider } from './provider.js';
import { normalizePart, type AgentEvent, type TokenUsage } from './stream.js';
import { buildSystemPrompt } from './system-prompt.js';

export type { AgentEvent, TokenUsage };
export type { ToolDescriptor };
export { describeProvider };

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
      stopWhen: stepCountIs(10),
      temperature: 0.2,
    });

    for await (const part of result.fullStream) {
      const ev = normalizePart(part as Parameters<typeof normalizePart>[0]);
      if (ev) yield ev;
    }

    const finalMessages = (await result.response).messages;
    yield { type: 'done', result: [...messages, ...finalMessages] };
  } catch (e: unknown) {
    yield { type: 'error', error: e instanceof Error ? e.message : String(e) };
  }
}
