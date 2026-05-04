import { describe, expect, it } from 'vitest';
import { truncate } from '../../src/cli/util.js';

describe('truncate', () => {
  it('returns the string unchanged when shorter than n', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  it('returns the string unchanged when exactly n', () => {
    expect(truncate('hello', 5)).toBe('hello');
  });

  it('appends ellipsis when longer than n', () => {
    expect(truncate('helloworld', 5)).toBe('hello…');
  });

  it('default cap is 200', () => {
    expect(truncate('a'.repeat(199))).toBe('a'.repeat(199));
    expect(truncate('a'.repeat(201))).toBe('a'.repeat(200) + '…');
  });

  it('handles empty string', () => {
    expect(truncate('', 5)).toBe('');
  });
});
