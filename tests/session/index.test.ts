import { describe, expect, it } from 'vitest';
import { createSession } from '../../src/session/index.js';

describe('createSession', () => {
  it('returns a session with a 12-hex-char id', async () => {
    const s = await createSession('/tmp', { cwd: '/tmp', provider: 'ollama' });
    expect(s.id).toMatch(/^[0-9a-f]{12}$/);
  });

  it('two consecutive ids differ', async () => {
    const a = await createSession('/tmp');
    const b = await createSession('/tmp');
    expect(a.id).not.toBe(b.id);
  });

  it('captures cwd and provider when supplied', async () => {
    const s = await createSession('/repo', {
      cwd: '/repo/sub',
      provider: 'remote · gpt-4o-mini',
    });
    expect(s.cwd).toBe('/repo/sub');
    expect(s.provider).toBe('remote · gpt-4o-mini');
  });

  it('falls back to process.cwd() and "unknown" provider when omitted', async () => {
    const s = await createSession('/tmp');
    expect(s.cwd).toBe(process.cwd());
    expect(s.provider).toBe('unknown');
  });

  it('starts with empty history and matching createdAt/updatedAt', async () => {
    const s = await createSession('/tmp');
    expect(s.history).toEqual([]);
    expect(s.createdAt).toBe(s.updatedAt);
    expect(s.version).toBe(1);
  });
});
