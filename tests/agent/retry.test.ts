import { describe, expect, it, vi } from 'vitest';
import { isRetryable, withRetry } from '../../src/agent/retry.js';

const noSleep = async () => {};

describe('isRetryable', () => {
  it('rejects nullish errors', () => {
    expect(isRetryable(null)).toBe(false);
    expect(isRetryable(undefined)).toBe(false);
  });

  it('never retries a user abort', () => {
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    expect(isRetryable(abort)).toBe(false);
  });

  it('retries transient status codes', () => {
    for (const status of [408, 425, 429, 500, 502, 503, 504]) {
      expect(isRetryable(Object.assign(new Error('boom'), { statusCode: status }))).toBe(true);
    }
  });

  it('does not retry deterministic status codes', () => {
    for (const status of [400, 401, 403, 404, 422]) {
      expect(isRetryable(Object.assign(new Error('nope'), { status }))).toBe(false);
    }
  });

  it('retries network-level failures by message', () => {
    expect(isRetryable(new Error('read ECONNRESET'))).toBe(true);
    expect(isRetryable(new Error('fetch failed'))).toBe(true);
    expect(isRetryable(new Error('socket hang up'))).toBe(true);
  });

  it('does not retry an unrecognised message', () => {
    expect(isRetryable(new Error('model not found'))).toBe(false);
  });

  it('inspects the cause chain', () => {
    const outer = new Error('request failed');
    (outer as Error & { cause?: unknown }).cause = new Error('connect ECONNREFUSED');
    expect(isRetryable(outer)).toBe(true);
  });

  it('does not loop forever on a self-referential cause', () => {
    const err = new Error('weird');
    (err as Error & { cause?: unknown }).cause = err;
    expect(isRetryable(err)).toBe(false);
  });
});

describe('withRetry', () => {
  it('returns the first successful result without sleeping', async () => {
    const sleep = vi.fn(noSleep);
    const result = await withRetry(async () => 'ok', { sleep });
    expect(result).toBe('ok');
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries transient failures and eventually succeeds', async () => {
    const attempts: number[] = [];
    const result = await withRetry(
      async (attempt) => {
        attempts.push(attempt);
        if (attempt < 3) throw new Error('fetch failed');
        return 'recovered';
      },
      { sleep: noSleep },
    );
    expect(result).toBe('recovered');
    expect(attempts).toEqual([1, 2, 3]);
  });

  it('rethrows immediately for a fatal error', async () => {
    const fn = vi.fn(async () => {
      throw new Error('model not found');
    });
    await expect(withRetry(fn, { sleep: noSleep })).rejects.toThrow('model not found');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('gives up after maxAttempts', async () => {
    const fn = vi.fn(async () => {
      throw new Error('fetch failed');
    });
    await expect(withRetry(fn, { sleep: noSleep, maxAttempts: 2 })).rejects.toThrow('fetch failed');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('backs off exponentially and reports each retry', async () => {
    const delays: number[] = [];
    const onRetry = vi.fn();
    await expect(
      withRetry(
        async () => {
          throw new Error('ETIMEDOUT');
        },
        {
          maxAttempts: 3,
          baseDelayMs: 100,
          onRetry,
          sleep: async (ms) => {
            delays.push(ms);
          },
        },
      ),
    ).rejects.toThrow('ETIMEDOUT');
    expect(delays).toHaveLength(2);
    // Jitter is 0.5–1.5x of base * 2^(attempt-1).
    expect(delays[0]).toBeGreaterThanOrEqual(50);
    expect(delays[0]).toBeLessThanOrEqual(150);
    expect(delays[1]).toBeGreaterThanOrEqual(100);
    expect(delays[1]).toBeLessThanOrEqual(300);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('stops retrying once the signal is aborted', async () => {
    const controller = new AbortController();
    const fn = vi.fn(async () => {
      controller.abort();
      throw new Error('fetch failed');
    });
    await expect(
      withRetry(fn, { sleep: noSleep, signal: controller.signal }),
    ).rejects.toThrow('fetch failed');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
