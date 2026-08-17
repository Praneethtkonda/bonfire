import { describe, expect, it } from 'vitest';
import type { ModelMessage } from 'ai';
import {
  autoCompact,
  compactHistory,
  contextStatus,
  estimateHistoryTokens,
  estimateTokens,
} from '../../src/agent/context.js';

function user(text: string): ModelMessage {
  return { role: 'user', content: text };
}

function assistantWithCall(id: string, text: string): ModelMessage {
  return {
    role: 'assistant',
    content: [
      { type: 'text', text },
      { type: 'tool-call', toolCallId: id, toolName: 'read_file', input: { path: 'a.ts' } },
    ],
  } as ModelMessage;
}

function toolResult(id: string, output: string): ModelMessage {
  return {
    role: 'tool',
    content: [
      {
        type: 'tool-result',
        toolCallId: id,
        toolName: 'read_file',
        output: { type: 'text', value: output },
      },
    ],
  } as ModelMessage;
}

/** Every tool-result id must have a matching tool-call id earlier in history. */
function orphanedToolResults(messages: ModelMessage[]): string[] {
  const declared = new Set<string>();
  const orphans: string[] = [];
  for (const m of messages) {
    if (!Array.isArray(m.content)) continue;
    for (const part of m.content as Array<Record<string, unknown>>) {
      if (part.type === 'tool-call') declared.add(String(part.toolCallId));
      if (part.type === 'tool-result' && !declared.has(String(part.toolCallId))) {
        orphans.push(String(part.toolCallId));
      }
    }
  }
  return orphans;
}

describe('estimateTokens', () => {
  it('returns zero for empty text', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('scales with length at roughly four characters per token', () => {
    expect(estimateTokens('a'.repeat(400))).toBe(100);
  });

  it('adds per-message overhead across a history', () => {
    const messages = [user('abcd'), user('abcd')];
    // 1 token of text + 4 tokens overhead, twice.
    expect(estimateHistoryTokens(messages)).toBe(10);
  });

  it('counts structured content by serializing it', () => {
    const structured = estimateHistoryTokens([toolResult('t1', 'x'.repeat(400))]);
    expect(structured).toBeGreaterThan(100);
  });
});

describe('contextStatus', () => {
  it('includes the system prompt in the used total', () => {
    const status = contextStatus([user('abcd')], 100, 1000);
    expect(status.used).toBe(105);
    expect(status.max).toBe(1000);
    expect(status.ratio).toBeCloseTo(0.105);
  });

  it('reports a ratio above one when the history already overflowed', () => {
    expect(contextStatus([user('a'.repeat(8000))], 0, 100).ratio).toBeGreaterThan(1);
  });

  it('avoids dividing by zero when no window is configured', () => {
    expect(contextStatus([user('hi')], 0, 0).ratio).toBe(0);
  });
});

describe('compactHistory', () => {
  it('is a no-op when the history already fits', () => {
    const messages = [user('hello'), user('there')];
    const result = compactHistory(messages, { targetTokens: 10_000 });
    expect(result.changed).toBe(false);
    expect(result.messages).toBe(messages);
    expect(result.droppedMessages).toBe(0);
  });

  it('trims oversized tool outputs outside the protected tail', () => {
    const messages: ModelMessage[] = [
      user('first'),
      assistantWithCall('t1', 'reading'),
      toolResult('t1', 'y'.repeat(5000)),
      user('second'),
      user('third'),
    ];
    const result = compactHistory(messages, { targetTokens: 200, keepRecent: 2 });
    expect(result.trimmedToolOutputs).toBe(1);
    const trimmedText = JSON.stringify(result.messages.find((m) => m.role === 'tool')?.content);
    expect(trimmedText).toContain('characters trimmed');
    expect(result.tokensAfter).toBeLessThan(result.tokensBefore);
  });

  it('leaves recent tool outputs untouched', () => {
    const messages: ModelMessage[] = [
      user('first'),
      assistantWithCall('t1', 'reading'),
      toolResult('t1', 'z'.repeat(5000)),
    ];
    const result = compactHistory(messages, { targetTokens: 10, keepRecent: 6 });
    expect(result.trimmedToolOutputs).toBe(0);
  });

  it('drops whole turns only at user-message boundaries', () => {
    const messages: ModelMessage[] = [];
    for (let turn = 0; turn < 6; turn++) {
      messages.push(user(`question ${turn} ${'q'.repeat(400)}`));
      messages.push(assistantWithCall(`t${turn}`, 'looking'));
      messages.push(toolResult(`t${turn}`, 'r'.repeat(100)));
    }
    const result = compactHistory(messages, { targetTokens: 400, keepRecent: 6 });
    expect(result.droppedMessages).toBeGreaterThan(0);
    expect(result.messages[0].role).toBe('user');
    expect(orphanedToolResults(result.messages)).toEqual([]);
  });

  it('never cuts below the recent-message floor', () => {
    const messages: ModelMessage[] = [];
    for (let i = 0; i < 8; i++) messages.push(user('u'.repeat(4000)));
    const result = compactHistory(messages, { targetTokens: 10, keepRecent: 6 });
    expect(result.messages.length).toBeGreaterThanOrEqual(6);
  });

  it('reclaims as much as the target requires rather than stopping at the first cut', () => {
    const messages: ModelMessage[] = [];
    for (let i = 0; i < 10; i++) messages.push(user('u'.repeat(2000)));
    const result = compactHistory(messages, { targetTokens: 2000, keepRecent: 2 });
    expect(estimateHistoryTokens(result.messages)).toBeLessThanOrEqual(2000);
  });

  it('handles an empty history', () => {
    const result = compactHistory([], { targetTokens: 10 });
    expect(result.changed).toBe(false);
    expect(result.messages).toEqual([]);
  });
});

describe('autoCompact', () => {
  const settings = { maxTokens: 1000, compactThreshold: 0.75, autoCompact: true };

  it('does nothing below the threshold', () => {
    const messages = [user('short')];
    expect(autoCompact(messages, settings).changed).toBe(false);
  });

  it('does nothing when auto-compaction is disabled', () => {
    const messages: ModelMessage[] = [];
    for (let i = 0; i < 10; i++) messages.push(user('u'.repeat(2000)));
    const result = autoCompact(messages, { ...settings, autoCompact: false });
    expect(result.changed).toBe(false);
    expect(result.messages).toBe(messages);
  });

  it('compacts once the threshold is crossed', () => {
    const messages: ModelMessage[] = [];
    for (let i = 0; i < 12; i++) messages.push(user('u'.repeat(1000)));
    const result = autoCompact(messages, settings);
    expect(result.changed).toBe(true);
    expect(result.tokensAfter).toBeLessThan(result.tokensBefore);
  });

  it('counts the system prompt toward the threshold', () => {
    const messages: ModelMessage[] = [];
    for (let i = 0; i < 8; i++) messages.push(user('u'.repeat(300)));
    expect(autoCompact(messages, settings, 0).changed).toBe(false);
    expect(autoCompact(messages, settings, 600).changed).toBe(true);
  });

  it('targets a fraction of the window rather than a fixed floor', () => {
    const small = { maxTokens: 512, compactThreshold: 0.75, autoCompact: true };
    const messages: ModelMessage[] = [];
    for (let i = 0; i < 12; i++) messages.push(user('u'.repeat(400)));
    const result = autoCompact(messages, small);
    expect(result.changed).toBe(true);
    expect(result.tokensAfter).toBeLessThan(result.tokensBefore);
  });
});
