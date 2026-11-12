import { describe, expect, it } from 'vitest';
import { isLooping } from '../../src/agent/loop-guard.js';

const step = (cmd: string, out: string) => ({
  toolCalls: [{ toolName: 'shell', input: { command: cmd } }],
  toolResults: [{ toolName: 'shell', output: { exitCode: 1, stderr: out } }],
});

describe('isLooping', () => {
  it('stops after three identical calls with identical results', () => {
    expect(isLooping([step('npm test', 'boom'), step('npm test', 'boom')])).toBe(false);
    expect(isLooping([step('npm test', 'boom'), step('npm test', 'boom'), step('npm test', 'boom')])).toBe(true);
  });

  it('keeps going when the call or its result changes, or a step has no calls', () => {
    expect(isLooping([step('npm test', 'a'), step('npm test', 'b'), step('npm test', 'b')])).toBe(false);
    expect(isLooping([step('a', 'x'), step('b', 'x'), step('b', 'x')])).toBe(false);
    expect(isLooping([{}, {}, {}])).toBe(false);
  });
});
