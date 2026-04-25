import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
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
