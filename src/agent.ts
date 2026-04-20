import { streamText, stepCountIs, type ModelMessage } from 'ai';
import { createOllama } from 'ollama-ai-provider-v2';
import { tools as builtinTools } from './tools.js';
import { loadMcpServers, type LoadedMcp } from './mcp.js';

let mcpState: LoadedMcp | null = null;

export async function initMcp(): Promise<number> {
  mcpState = await loadMcpServers();
  return Object.keys(mcpState.tools).length;
}

export async function shutdownMcp(): Promise<void> {
  if (mcpState) await mcpState.close();
}

const OLLAMA_URL = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434/api';
const MODEL = process.env.NANO_MODEL ?? 'qwen2.5-coder:latest';

const DEBUG = process.env.NANO_DEBUG === '1';

const debugFetch: typeof fetch = async (input, init) => {
  if (DEBUG && init?.body) {
    try {
      const body = JSON.parse(String(init.body));
      const toolCount = Array.isArray(body.tools) ? body.tools.length : 0;
      const toolNames = (body.tools ?? []).map((t: any) => t?.function?.name).join(',');
      console.error(`[debug] POST ${input} · tools=${toolCount} [${toolNames}]`);
    } catch {
      console.error(`[debug] POST ${input} · (non-json body)`);
    }
  }
  const res = await fetch(input, init);
  if (DEBUG) console.error(`[debug] <- ${res.status}`);
  return res;
};

const ollama = createOllama({ baseURL: OLLAMA_URL, fetch: debugFetch });

const SYSTEM_PROMPT = `You are nano-code, a terminal coding assistant.

You have tools to read, write, edit files, list directories, and run shell commands in the user's working directory.

Rules:
- When the user asks for a change, use tools to actually do it. Do not just describe.
- Before editing an existing file, read it first.
- Prefer edit_file over write_file for existing files.
- Keep replies short. The user can see tool output.
- After completing the task, confirm what you did in one sentence.`;

export interface AgentEvent {
  type: 'text' | 'tool-call' | 'tool-result' | 'done' | 'error';
  text?: string;
  toolName?: string;
  args?: unknown;
  result?: unknown;
  error?: string;
}

export async function* runAgent(
  history: ModelMessage[],
  userInput: string
): AsyncGenerator<AgentEvent> {
  const messages: ModelMessage[] = [
    ...history,
    { role: 'user', content: userInput },
  ];

  try {
    const disableBuiltins = process.env.NANO_DISABLE_BUILTINS === '1';
    const mergedTools = {
      ...(disableBuiltins ? {} : builtinTools),
      ...(mcpState?.tools ?? {}),
    };
    console.log(mergedTools);
    const result = streamText({
      model: ollama(MODEL),
      system: SYSTEM_PROMPT,
      messages,
      tools: mergedTools,
      stopWhen: stepCountIs(10),
      temperature: 0.2,
    });

    for await (const part of result.fullStream) {
      if (part.type === 'text-delta') {
        yield { type: 'text', text: part.text };
      } else if (part.type === 'tool-call') {
        yield { type: 'tool-call', toolName: part.toolName, args: (part as any).input };
      } else if (part.type === 'tool-result') {
        yield { type: 'tool-result', toolName: part.toolName, result: (part as any).output };
      } else if (part.type === 'error') {
        yield { type: 'error', error: String(part.error) };
      }
    }

    const finalMessages = (await result.response).messages;
    yield { type: 'done', result: [...messages, ...finalMessages] };
  } catch (e: any) {
    yield { type: 'error', error: e.message ?? String(e) };
  }
}
