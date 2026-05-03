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

/**
 * The AI SDK's streaming events are loosely typed; we narrow each variant here
 * so the rest of the codebase never touches a `part.<field> as any`.
 */
interface RawPart {
  type: string;
  text?: string;
  toolName?: string;
  id?: string;
  toolCallId?: string;
  delta?: string;
  argsTextDelta?: string;
  input?: unknown;
  args?: unknown;
  output?: unknown;
  result?: unknown;
  error?: unknown;
  totalUsage?: RawUsage;
  usage?: RawUsage;
}

interface RawUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  promptTokens?: number;
  completionTokens?: number;
}

function normalizeUsage(raw: RawUsage | undefined): TokenUsage | null {
  if (!raw) return null;
  const input = raw.inputTokens ?? raw.promptTokens ?? 0;
  const output = raw.outputTokens ?? raw.completionTokens ?? 0;
  const total = raw.totalTokens ?? input + output;
  return { input, output, total };
}

export function normalizePart(raw: RawPart): AgentEvent | null {
  switch (raw.type) {
    case 'text-delta':
      return { type: 'text', text: raw.text };
    case 'tool-input-start':
    case 'tool-call-streaming-start':
      return {
        type: 'tool-input-start',
        toolName: raw.toolName,
        toolCallId: raw.id ?? raw.toolCallId,
      };
    case 'tool-input-delta':
    case 'tool-call-delta':
      return {
        type: 'tool-input-delta',
        toolCallId: raw.id ?? raw.toolCallId,
        delta: raw.delta ?? raw.argsTextDelta ?? '',
      };
    case 'tool-call':
      return {
        type: 'tool-call',
        toolName: raw.toolName,
        toolCallId: raw.toolCallId,
        args: raw.input ?? raw.args,
      };
    case 'tool-result':
      return {
        type: 'tool-result',
        toolName: raw.toolName,
        toolCallId: raw.toolCallId,
        result: raw.output ?? raw.result,
      };
    case 'finish': {
      const usage = normalizeUsage(raw.totalUsage ?? raw.usage);
      return usage ? { type: 'usage', usage } : null;
    }
    case 'error': {
      let errorMsg = 'Unknown error';
      if (raw.error instanceof Error) {
        errorMsg = raw.error.message;
        // Extract status code from error message if present
        if (raw.error.message.includes('401')) {
          errorMsg = 'Authentication failed (401). Check your API key with /reconfigure.';
        } else if (raw.error.message.includes('403')) {
          errorMsg = 'Forbidden (403). Check your API key permissions.';
        } else if (raw.error.message.includes('429')) {
          errorMsg = 'Rate limit exceeded (429). Please wait and try again.';
        } else if (raw.error.message.includes('500')) {
          errorMsg = 'Server error (500). The model service may be down.';
        } else if (raw.error.message.includes('503')) {
          errorMsg = 'Service unavailable (503). The model service may be overloaded.';
        } else if (raw.error.message.includes('ECONNREFUSED')) {
          errorMsg = 'Could not connect. Is the model server running?';
        } else if (raw.error.message.includes('timeout')) {
          errorMsg = 'Request timed out. The model may be slow or unresponsive.';
        }
      } else if (raw.error) {
        errorMsg = String(raw.error);
      }
      return { type: 'error', error: errorMsg };
    }
    default:
      return null;
  }
}
