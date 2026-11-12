/**
 * Keep the start and the end of `text`, cutting the middle. Build and test
 * output puts the errors and the summary at the end, so a head-only cut
 * would lose exactly the part the model needs.
 */
export function headTail(text: string, max: number, headShare = 0.4): string {
  if (text.length <= max) return text;
  const cut = text.length - max;
  const marker = `\n\n[… ${cut} of ${text.length} characters cut from the middle …]\n\n`;
  const room = Math.max(0, max - marker.length);
  const head = Math.floor(room * headShare);
  const tail = room - head;
  return `${text.slice(0, head)}${marker}${tail > 0 ? text.slice(text.length - tail) : ''}`;
}

/** Hard ceiling on a tool result, whatever the window. */
export const TOOL_OUTPUT_MAX_CHARS = 64_000;
/** Floor so a tiny window still gets usable tool output. */
export const TOOL_OUTPUT_MIN_CHARS = 4_000;
/** Share of the context window one tool result may take. */
export const TOOL_OUTPUT_WINDOW_SHARE = 0.15;

let toolOutputLimit = TOOL_OUTPUT_MAX_CHARS;

/** Size tool results to the context window (about 4 characters per token). */
export function setToolOutputBudget(maxTokens: number): void {
  const chars = Math.floor(maxTokens * TOOL_OUTPUT_WINDOW_SHARE * 4);
  toolOutputLimit = Math.min(TOOL_OUTPUT_MAX_CHARS, Math.max(TOOL_OUTPUT_MIN_CHARS, chars));
}

export function toolOutputMaxChars(): number {
  return toolOutputLimit;
}

export function capText(text: string, max: number = toolOutputLimit): string {
  return headTail(text, max);
}

interface McpResult {
  content?: Array<{ type?: string; text?: string }>;
  isError?: boolean;
}

/**
 * Cap a tool result at the window-relative limit. MCP results keep their
 * `{content: [...]}` shape because the MCP adapter converts them for the model.
 */
export function capToolOutput(output: unknown, mcp: boolean): unknown {
  const text = typeof output === 'string' ? output : (JSON.stringify(output) ?? '');
  if (text.length <= toolOutputLimit) return output;
  const r = output as McpResult;
  if (mcp && r && typeof r === 'object' && Array.isArray(r.content)) {
    const joined = r.content
      .map((c) => (c.type === 'text' ? (c.text ?? '') : JSON.stringify(c)))
      .join('\n');
    return { content: [{ type: 'text', text: capText(joined) }], isError: r.isError };
  }
  return capText(text);
}

interface ExecutableTool {
  execute?: (input: unknown, options: unknown) => unknown;
}

/** Wrap a tool so its result is capped before the model sees it. */
export function withOutputCap<T>(t: T, mcp: boolean): T {
  const execute = (t as ExecutableTool)?.execute;
  if (typeof execute !== 'function') return t;
  return {
    ...t,
    execute: async (input: unknown, options: unknown) =>
      capToolOutput(await execute.call(t, input, options), mcp),
  } as T;
}
