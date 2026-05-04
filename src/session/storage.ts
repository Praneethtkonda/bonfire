import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Session } from './types.js';

const SESSIONS_DIR = '.bonfire/sessions';
const SESSION_FILE_EXT = '.json';

export function sessionsDir(root: string): string {
  return resolve(root, SESSIONS_DIR);
}

export function sessionPath(root: string, id: string): string {
  return resolve(sessionsDir(root), `${id}${SESSION_FILE_EXT}`);
}

export const sessionFileExt = SESSION_FILE_EXT;

export class AmbiguousSessionIdError extends Error {
  constructor(public readonly prefix: string, public readonly matches: string[]) {
    super(
      `Ambiguous session id "${prefix}" — matches ${matches.length}: ${matches
        .slice(0, 5)
        .join(', ')}${matches.length > 5 ? ', …' : ''}`,
    );
    this.name = 'AmbiguousSessionIdError';
  }
}

/**
 * Resolve a possibly-truncated session id to its full form by listing the
 * sessions directory. Exact matches win immediately. A unique prefix returns
 * the matching id. An ambiguous prefix throws AmbiguousSessionIdError so the
 * caller can ask for more characters. Returns null if nothing matches.
 */
export async function resolveSessionId(
  root: string,
  partial: string,
): Promise<string | null> {
  if (!partial) return null;
  let entries: string[];
  try {
    entries = await readdir(sessionsDir(root));
  } catch {
    return null;
  }
  const ids = entries
    .filter((e) => e.endsWith(SESSION_FILE_EXT))
    .map((e) => e.slice(0, -SESSION_FILE_EXT.length));
  if (ids.includes(partial)) return partial;
  const matches = ids.filter((id) => id.startsWith(partial));
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];
  throw new AmbiguousSessionIdError(partial, matches);
}

/** Load a session by ID. Returns null if not found or unparseable. */
export async function loadSession(root: string, id: string): Promise<Session | null> {
  try {
    const raw = await readFile(sessionPath(root, id), 'utf-8');
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

/** Persist a session to disk. */
export async function saveSession(root: string, session: Session): Promise<string> {
  await mkdir(sessionsDir(root), { recursive: true });
  await writeFile(
    sessionPath(root, session.id),
    JSON.stringify(session, null, 2),
    'utf-8',
  );
  return session.id;
}

/** Delete a session by ID. Returns true if a file was removed. */
export async function deleteSession(root: string, id: string): Promise<boolean> {
  const p = sessionPath(root, id);
  try {
    await readFile(p, 'utf-8');
    await unlink(p);
    return true;
  } catch {
    return false;
  }
}
