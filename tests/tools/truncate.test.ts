import { describe, expect, it } from 'vitest';
import { headTail } from '../../src/tools/truncate.js';

describe('headTail', () => {
  it('keeps short text and cuts the middle of long text within the limit', () => {
    expect(headTail('short', 100)).toBe('short');
    const text = `START${'m'.repeat(5_000)}ERROR: test failed`;
    const out = headTail(text, 500);
    expect(out.length).toBeLessThanOrEqual(500);
    expect(out.startsWith('START')).toBe(true);
    expect(out.endsWith('ERROR: test failed')).toBe(true);
    expect(out).toContain('cut from the middle');
  });
});
