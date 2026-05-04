import { describe, expect, it } from 'vitest';
import { normalizePart } from '../../src/agent/stream.js';

describe('normalizePart', () => {
  it('translates text-delta', () => {
    const ev = normalizePart({ type: 'text-delta', text: 'hello' });
    expect(ev).toEqual({ type: 'text', text: 'hello' });
  });

  it('translates tool-input-start using id', () => {
    const ev = normalizePart({
      type: 'tool-input-start',
      toolName: 'shell',
      id: 'call-1',
    });
    expect(ev).toEqual({
      type: 'tool-input-start',
      toolName: 'shell',
      toolCallId: 'call-1',
    });
  });

  it('translates legacy tool-call-streaming-start using toolCallId', () => {
    const ev = normalizePart({
      type: 'tool-call-streaming-start',
      toolName: 'shell',
      toolCallId: 'call-2',
    });
    expect(ev?.type).toBe('tool-input-start');
    expect(ev?.toolCallId).toBe('call-2');
  });

  it('translates tool-input-delta with delta', () => {
    const ev = normalizePart({
      type: 'tool-input-delta',
      id: 'call-3',
      delta: '{"a":',
    });
    expect(ev).toEqual({
      type: 'tool-input-delta',
      toolCallId: 'call-3',
      delta: '{"a":',
    });
  });

  it('translates legacy tool-call-delta with argsTextDelta', () => {
    const ev = normalizePart({
      type: 'tool-call-delta',
      toolCallId: 'call-4',
      argsTextDelta: '"b"}',
    });
    expect(ev?.delta).toBe('"b"}');
  });

  it('translates tool-call with input/args', () => {
    const ev = normalizePart({
      type: 'tool-call',
      toolName: 'read_file',
      toolCallId: 'call-5',
      input: { path: 'README.md' },
    });
    expect(ev).toEqual({
      type: 'tool-call',
      toolName: 'read_file',
      toolCallId: 'call-5',
      args: { path: 'README.md' },
    });
  });

  it('falls back to args when input is absent', () => {
    const ev = normalizePart({
      type: 'tool-call',
      toolName: 'read_file',
      toolCallId: 'call-5b',
      args: { path: 'fallback' },
    });
    expect(ev?.args).toEqual({ path: 'fallback' });
  });

  it('translates tool-result preferring output over result', () => {
    const ev = normalizePart({
      type: 'tool-result',
      toolName: 'read_file',
      toolCallId: 'call-6',
      output: { ok: true },
      result: { ok: false }, // ignored when output is present
    });
    expect(ev?.result).toEqual({ ok: true });
  });

  it('falls back to result when output is missing', () => {
    const ev = normalizePart({
      type: 'tool-result',
      toolName: 'shell',
      toolCallId: 'call-7',
      result: { exitCode: 0 },
    });
    expect(ev?.result).toEqual({ exitCode: 0 });
  });

  it('translates finish with totalUsage in canonical shape', () => {
    const ev = normalizePart({
      type: 'finish',
      totalUsage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    });
    expect(ev).toEqual({
      type: 'usage',
      usage: { input: 100, output: 50, total: 150 },
    });
  });

  it('translates finish with legacy promptTokens/completionTokens', () => {
    const ev = normalizePart({
      type: 'finish',
      usage: { promptTokens: 30, completionTokens: 20 },
    });
    expect(ev).toEqual({
      type: 'usage',
      usage: { input: 30, output: 20, total: 50 }, // computed when totalTokens missing
    });
  });

  it('returns null on finish without usage', () => {
    expect(normalizePart({ type: 'finish' })).toBeNull();
  });

  it('routes error events through formatProviderError', () => {
    const ev = normalizePart({
      type: 'error',
      error: new Error('connect ECONNREFUSED 1.2.3.4'),
    });
    expect(ev?.type).toBe('error');
    expect(ev?.error).toMatch(/Could not connect/);
  });

  it('error with non-Error value still produces a string', () => {
    const ev = normalizePart({ type: 'error', error: 'just a string' });
    expect(ev?.error).toBe('just a string');
  });

  it('returns null for unknown event types', () => {
    expect(normalizePart({ type: 'something-else' })).toBeNull();
  });
});
