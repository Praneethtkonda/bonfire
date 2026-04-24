import { streamText, stepCountIs, type ModelMessage } from 'ai';
import { tools as builtinTools, getAllowedDirs } from './tools.js';
import { loadMcpServers, type LoadedMcp } from './mcp.js';
import { resolveProvider, type ResolvedProvider } from './providers/index.js';

let mcpState: LoadedMcp | null = null;
let providerState: ResolvedProvider | null = null;

export async function initMcp(): Promise<number> {
  mcpState = await loadMcpServers();
  return Object.keys(mcpState.tools).length;
}

export async function shutdownMcp(): Promise<void> {
  if (mcpState) await mcpState.close();
}

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

async function getProvider(): Promise<ResolvedProvider> {
  if (!providerState) {
    providerState = await resolveProvider({ fetchImpl: debugFetch });
  }
  return providerState;
}

export async function describeProvider(): Promise<string> {
  const p = await getProvider();
  return p.label;
}

const PLATFORM_HINT = (() => {
  if (process.platform === 'win32') {
    return 'You are running on Windows. The `shell` tool invokes cmd.exe — use Windows-native commands (dir, type, findstr, copy, del, Remove-Item via powershell -Command). Do not use Unix utilities like ls/grep/cat/rm.';
  }
  if (process.platform === 'darwin') {
    return 'You are running on macOS. The `shell` tool invokes /bin/sh — use standard POSIX commands.';
  }
  return `You are running on ${process.platform}. The \`shell\` tool invokes /bin/sh — use standard POSIX commands.`;
})();

const SYSTEM_PROMPT_BASE = `You are nano-code, a terminal coding assistant.

You have tools to read, write, edit files, list directories, and run shell commands in the user's working directory.

${PLATFORM_HINT}

Rules:
- When the user asks for a change, use tools to actually do it. Do not just describe.
- Before editing an existing file, read it first.
- Prefer edit_file over write_file for existing files.
- Keep replies short. The user can see tool output.
- After completing the task, confirm what you did in one sentence.`;

function buildSystemPrompt(): string {
  const dirs = getAllowedDirs();
  if (dirs.length <= 1) return SYSTEM_PROMPT_BASE;
  const extras = dirs
    .slice(1)
    .map((d) => `- ${d}`)
    .join('\n');
  return `${SYSTEM_PROMPT_BASE}\n\nAdditional allowed directories (pass absolute paths to tools):\n${extras}`;
}

export interface TokenUsage {
  input: number;
  output: number;
  total: number;
}

export interface AgentEvent {
  type:
    | 'text'
    | 'tool-input-start'
    | 'tool-input-delta'
    | 'tool-call'
    | 'tool-result'
    | 'usage'
    | 'done'
    | 'error';
  text?: string;
  toolName?: string;
  toolCallId?: string;
  delta?: string;
  args?: unknown;
  result?: unknown;
  error?: string;
  usage?: TokenUsage;
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
    const provider = await getProvider();
    const disableBuiltins = process.env.NANO_DISABLE_BUILTINS === '1';
    const mergedTools = {
      ...(disableBuiltins ? {} : builtinTools),
      ...(mcpState?.tools ?? {}),
    };
    const result = streamText({
      model: provider.model,
      system: buildSystemPrompt(),
      messages,
      tools: mergedTools,
      stopWhen: stepCountIs(10),
      temperature: 0.2,
    });

    for await (const part of result.fullStream) {
      const t = (part as any).type as string;
      if (t === 'text-delta') {
        yield { type: 'text', text: (part as any).text };
      } else if (t === 'tool-input-start' || t === 'tool-call-streaming-start') {
        yield {
          type: 'tool-input-start',
          toolName: (part as any).toolName,
          toolCallId: (part as any).id ?? (part as any).toolCallId,
        };
      } else if (t === 'tool-input-delta' || t === 'tool-call-delta') {
        yield {
          type: 'tool-input-delta',
          toolCallId: (part as any).id ?? (part as any).toolCallId,
          delta:
            (part as any).delta ??
            (part as any).argsTextDelta ??
            '',
        };
      } else if (t === 'tool-call') {
        yield {
          type: 'tool-call',
          toolName: (part as any).toolName,
          toolCallId: (part as any).toolCallId,
          args: (part as any).input ?? (part as any).args,
        };
      } else if (t === 'tool-result') {
        yield {
          type: 'tool-result',
          toolName: (part as any).toolName,
          toolCallId: (part as any).toolCallId,
          result: (part as any).output ?? (part as any).result,
        };
      } else if (t === 'finish' || t === 'finish-step') {
        const raw =
          (part as any).totalUsage ??
          (part as any).usage ??
          null;
        if (raw) {
          const input = raw.inputTokens ?? raw.promptTokens ?? 0;
          const output = raw.outputTokens ?? raw.completionTokens ?? 0;
          const total = raw.totalTokens ?? input + output;
          if (t === 'finish') {
            yield { type: 'usage', usage: { input, output, total } };
          }
        }
      } else if (t === 'error') {
        yield { type: 'error', error: String((part as any).error) };
      }
    }

    const finalMessages = (await result.response).messages;
    yield { type: 'done', result: [...messages, ...finalMessages] };
  } catch (e: any) {
    yield { type: 'error', error: e.message ?? String(e) };
  }
}
