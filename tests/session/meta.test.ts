import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listSessions } from '../../src/session/meta.js';
import { sessionPath, sessionsDir } from '../../src/session/storage.js';
import type { Session } from '../../src/session/types.js';

let scratch: string;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'bonfire-meta-'));
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

async function plant(id: string, session: Partial<Session>): Promise<void> {
  const full: Session = {
    version: 1,
    id,
    cwd: scratch,
    provider: 'ollama',
    createdAt: 0,
    updatedAt: 0,
    history: [],
    ...session,
  };
  await mkdir(sessionsDir(scratch), { recursive: true });
  await writeFile(sessionPath(scratch, id), JSON.stringify(full), 'utf-8');
}

describe('listSessions', () => {
  it('returns an empty array when the sessions dir does not exist', async () => {
    expect(await listSessions(scratch)).toEqual([]);
  });

  it('lists all sessions sorted newest first', async () => {
    await plant('older', { updatedAt: 1_000 });
    await plant('newer', { updatedAt: 5_000 });
    await plant('middle', { updatedAt: 3_000 });
    const metas = await listSessions(scratch);
    expect(metas.map((m) => m.id)).toEqual(['newer', 'middle', 'older']);
  });

  it('extracts last user message into lastMessage', async () => {
    await plant('with-history', {
      updatedAt: 1,
      history: [
        { role: 'user', content: 'first question' },
        { role: 'assistant', content: 'first answer' },
        { role: 'user', content: 'follow-up' },
      ],
    });
    const [meta] = await listSessions(scratch);
    expect(meta.lastMessage).toBe('follow-up');
  });

  it('truncates the lastMessage at 80 chars and replaces newlines', async () => {
    const long = 'a'.repeat(100) + '\n' + 'b'.repeat(50);
    await plant('long', {
      updatedAt: 1,
      history: [{ role: 'user', content: long }],
    });
    const [meta] = await listSessions(scratch);
    expect(meta.lastMessage.length).toBe(80);
    expect(meta.lastMessage).not.toContain('\n');
  });

  it('reports turnCount = number of history messages', async () => {
    await plant('counted', {
      updatedAt: 1,
      history: [
        { role: 'user', content: 'a' },
        { role: 'assistant', content: 'b' },
        { role: 'user', content: 'c' },
      ],
    });
    const [meta] = await listSessions(scratch);
    expect(meta.turnCount).toBe(3);
  });

  it('falls back to filesystem mtime when the JSON is corrupt', async () => {
    await mkdir(sessionsDir(scratch), { recursive: true });
    await writeFile(sessionPath(scratch, 'broken'), '{not-json', 'utf-8');
    const metas = await listSessions(scratch);
    expect(metas).toHaveLength(1);
    expect(metas[0].id).toBe('broken');
    expect(metas[0].cwd).toBe('?');
    expect(metas[0].provider).toBe('?');
    expect(metas[0].turnCount).toBe(0);
  });

  it('only considers .json files', async () => {
    await plant('a', { updatedAt: 1 });
    await mkdir(sessionsDir(scratch), { recursive: true });
    await writeFile(join(sessionsDir(scratch), 'README.md'), 'noise', 'utf-8');
    const metas = await listSessions(scratch);
    expect(metas.map((m) => m.id)).toEqual(['a']);
  });
});
