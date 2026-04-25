import type { Session } from './types.js';

export type { Session, SessionMeta } from './types.js';
export { loadSession, saveSession, deleteSession } from './storage.js';
export { listSessions } from './meta.js';

function generateId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Create a new empty session in memory (call saveSession to persist). */
export async function createSession(
  _root: string,
  opts?: { cwd?: string; provider?: string },
): Promise<Session> {
  const cwd = opts?.cwd ?? process.cwd();
  const provider = opts?.provider ?? 'unknown';
  return {
    version: 1,
    id: generateId(),
    cwd,
    provider,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    history: [],
  };
}
