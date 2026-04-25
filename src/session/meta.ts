import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { sessionFileExt, sessionsDir } from './storage.js';
import type { Session, SessionMeta } from './types.js';

function lastUserMessage(history: Session['history']): string {
  const last = history.slice().reverse().find((m) => m.role === 'user');
  return last?.content?.toString().slice(0, 80).replace(/\n/g, ' ') ?? '';
}

/** List all session metadata, newest first. Skips unparseable files silently. */
export async function listSessions(root: string): Promise<SessionMeta[]> {
  const dir = sessionsDir(root);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const files = entries.filter((e) => e.endsWith(sessionFileExt));
  const metas: SessionMeta[] = [];
  for (const f of files) {
    const id = f.slice(0, -sessionFileExt.length);
    const p = resolve(dir, f);
    const s = await stat(p);
    let session: Session | null = null;
    try {
      session = JSON.parse(await readFile(p, 'utf-8')) as Session;
    } catch {
      // Corrupted file; surface what we can from filesystem stats.
    }
    metas.push({
      id,
      cwd: session?.cwd ?? '?',
      provider: session?.provider ?? '?',
      createdAt: session?.createdAt ?? s.mtimeMs,
      updatedAt: session?.updatedAt ?? s.mtimeMs,
      turnCount: session?.history.length ?? 0,
      lastMessage: session ? lastUserMessage(session.history) : '',
    });
  }
  return metas.sort((a, b) => b.updatedAt - a.updatedAt);
}
