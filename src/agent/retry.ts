/**
 * Retry policy for transient provider failures.
 *
 * A local model server that is still loading weights, a homelab box that just
 * dropped a socket, or a rate-limited remote endpoint should not kill the
 * turn. Deterministic failures (bad request, unknown model, auth) are not
 * retried — repeating them only wastes the user's time.
 */

const RETRYABLE_MESSAGE_RE =
  /\b(ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|EAI_AGAIN|ENOTFOUND|socket hang up|network error|fetch failed|terminated|timeout)\b/i;

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

interface StatusCarrier {
  statusCode?: unknown;
  status?: unknown;
  cause?: unknown;
}

function statusOf(error: unknown): number | undefined {
  const e = error as StatusCarrier | null;
  if (!e || typeof e !== 'object') return undefined;
  const raw = e.statusCode ?? e.status;
  return typeof raw === 'number' ? raw : undefined;
}

export function isRetryable(error: unknown): boolean {
  if (error === null || error === undefined) return false;

  // An explicit user abort is never retried.
  if (error instanceof Error && error.name === 'AbortError') return false;

  const status = statusOf(error);
  if (status !== undefined) return RETRYABLE_STATUS.has(status);

  const message = error instanceof Error ? error.message : String(error);
  if (RETRYABLE_MESSAGE_RE.test(message)) return true;

  const cause = (error as StatusCarrier)?.cause;
  if (cause && cause !== error) return isRetryable(cause);

  return false;
}

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  signal?: AbortSignal;
  onRetry?: (attempt: number, delayMs: number, error: unknown) => void;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Run `fn`, retrying transient failures with exponential backoff and jitter.
 * Rethrows the last error once attempts are exhausted or the error is fatal.
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 400;
  const sleep = options.sleep ?? defaultSleep;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (e: unknown) {
      lastError = e;
      if (options.signal?.aborted) throw e;
      if (attempt === maxAttempts || !isRetryable(e)) throw e;
      const delay = Math.round(baseDelayMs * 2 ** (attempt - 1) * (0.5 + Math.random()));
      options.onRetry?.(attempt, delay, e);
      await sleep(delay);
    }
  }
  throw lastError;
}
