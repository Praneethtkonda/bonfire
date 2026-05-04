import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AmbiguousSessionIdError,
  deleteSession,
  loadSession,
  resolveSessionId,
  saveSession,
  sessionPath,
  sessionsDir,
} from '../../src/session/storage.js';
import type { Session } from '../../src/session/types.js';

let scratch: string;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'bonfire-session-'));
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

function fixture(id: string): Session {
  return {
    version: 1,
    id,
    cwd: scratch,
    provider: 'ollama · qwen3.6:latest',
    createdAt: 0,
    updatedAt: 0,
    history: [],
  };
}

async function plant(id: string): Promise<void> {
  await mkdir(sessionsDir(scratch), { recursive: true });
  await writeFile(sessionPath(scratch, id), JSON.stringify(fixture(id)), 'utf-8');
}

describe('save / load / delete', () => {
  it('round-trips a session through saveSession + loadSession', async () => {
    await saveSession(scratch, fixture('a3f1c8d92b4e'));
    const loaded = await loadSession(scratch, 'a3f1c8d92b4e');
    expect(loaded?.id).toBe('a3f1c8d92b4e');
    expect(loaded?.history).toEqual([]);
  });

  it('returns null for a missing id', async () => {
    expect(await loadSession(scratch, 'no-such')).toBeNull();
  });

  it('deleteSession returns true on success and false when nothing to remove', async () => {
    await plant('x123');
    expect(await deleteSession(scratch, 'x123')).toBe(true);
    expect(await deleteSession(scratch, 'x123')).toBe(false);
  });
});

describe('resolveSessionId', () => {
  it('returns null for empty input', async () => {
    expect(await resolveSessionId(scratch, '')).toBeNull();
  });

  it('returns null when the sessions dir does not exist', async () => {
    expect(await resolveSessionId(scratch, 'abc')).toBeNull();
  });

  it('returns the full id when given an exact match', async () => {
    await plant('a3f1c8d92b4e');
    expect(await resolveSessionId(scratch, 'a3f1c8d92b4e')).toBe('a3f1c8d92b4e');
  });

  it('resolves a unique prefix', async () => {
    await plant('a3f1c8d92b4e');
    await plant('92c1f0e8a4b7');
    expect(await resolveSessionId(scratch, 'a3f')).toBe('a3f1c8d92b4e');
    expect(await resolveSessionId(scratch, '92c')).toBe('92c1f0e8a4b7');
  });

  it('returns null for an unknown prefix', async () => {
    await plant('a3f1c8d92b4e');
    expect(await resolveSessionId(scratch, 'zzz')).toBeNull();
  });

  it('throws AmbiguousSessionIdError when the prefix matches multiple ids', async () => {
    await plant('abc111');
    await plant('abc222');
    await plant('abc333');
    await expect(resolveSessionId(scratch, 'abc')).rejects.toBeInstanceOf(
      AmbiguousSessionIdError,
    );
    try {
      await resolveSessionId(scratch, 'abc');
    } catch (e) {
      expect(e).toBeInstanceOf(AmbiguousSessionIdError);
      const err = e as AmbiguousSessionIdError;
      expect(err.matches.sort()).toEqual(['abc111', 'abc222', 'abc333']);
      expect(err.prefix).toBe('abc');
      expect(err.message).toContain('Ambiguous session id');
    }
  });

  it('exact match wins over prefix collision', async () => {
    await plant('abc');
    await plant('abc-extended');
    expect(await resolveSessionId(scratch, 'abc')).toBe('abc');
  });

  it('ignores files without the .json extension', async () => {
    await plant('keep');
    await mkdir(sessionsDir(scratch), { recursive: true });
    await writeFile(join(sessionsDir(scratch), 'noise.txt'), 'noise');
    expect(await resolveSessionId(scratch, 'keep')).toBe('keep');
  });
});
