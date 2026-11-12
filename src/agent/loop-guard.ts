/**
 * Stops a run that keeps making the same tool calls and getting the same
 * results, e.g. re-running a failing command unchanged. Without it the only
 * limit is the step cap.
 */
export const LOOP_REPEATS = 3;

interface StepLike {
  toolCalls?: ReadonlyArray<{ toolName?: string; input?: unknown }>;
  toolResults?: ReadonlyArray<{ toolName?: string; output?: unknown }>;
}

function signature(step: StepLike): string | null {
  const calls = step.toolCalls ?? [];
  if (calls.length === 0) return null;
  try {
    return JSON.stringify([
      calls.map((c) => [c.toolName, c.input]),
      (step.toolResults ?? []).map((r) => [r.toolName, r.output]),
    ]);
  } catch {
    return null;
  }
}

export function isLooping(steps: ReadonlyArray<StepLike>, repeats = LOOP_REPEATS): boolean {
  if (steps.length < repeats) return false;
  const last = steps.slice(-repeats).map(signature);
  return last[0] !== null && last.every((s) => s === last[0]);
}

export const LOOP_NOTICE = `stopped: the same tool call returned the same result ${LOOP_REPEATS} times in a row`;
