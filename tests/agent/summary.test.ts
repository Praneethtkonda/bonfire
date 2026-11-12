import { describe, expect, it } from 'vitest';
import type { ModelMessage } from 'ai';
import { compactHistory } from '../../src/agent/context.js';
import { originalRequest, SUMMARY_MARKER, withSummary } from '../../src/agent/summary.js';

function history(n: number): ModelMessage[] {
  const out: ModelMessage[] = [];
  for (let i = 0; i < n; i++) {
    out.push({ role: 'user', content: `request ${i} ${'u'.repeat(400)}` });
    out.push({ role: 'assistant', content: `reply ${i}` });
  }
  return out;
}

describe('withSummary', () => {
  it('replaces dropped turns with a note that pins the first request', async () => {
    const compacted = compactHistory(history(8), { targetTokens: 400 });
    expect(compacted.droppedMessages).toBeGreaterThan(0);
    let seen = '';
    const result = await withSummary(compacted, async (transcript) => {
      seen = transcript;
      return 'Goal: finish the work';
    });
    const first = result.messages[0];
    expect(first.role).toBe('user');
    expect(String(first.content)).toContain(SUMMARY_MARKER);
    expect(String(first.content)).toContain('request 0');
    expect(String(first.content)).toContain('Goal: finish the work');
    expect(seen).toContain('reply 0');
    expect(result.summarised).toBe(true);
    expect(result.messages).toHaveLength(compacted.messages.length);
  });

  it('keeps the first request through repeated compactions and when the model fails', async () => {
    const first = await withSummary(compactHistory(history(8), { targetTokens: 400 }), async () => null);
    expect(first.summarised).toBe(false);
    const more = [...first.messages, ...history(8).map((m) => ({ ...m }))];
    const second = await withSummary(compactHistory(more, { targetTokens: 400 }), async () => 'S2');
    expect(originalRequest(second.messages)).toBe(`request 0 ${'u'.repeat(400)}`);
  });

  it('leaves the result alone when nothing was dropped', async () => {
    const compacted = compactHistory(history(1), { targetTokens: 100_000 });
    const result = await withSummary(compacted, async () => 'unused');
    expect(result.messages).toBe(compacted.messages);
    expect(result.summarised).toBe(false);
  });
});
