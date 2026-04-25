import { realpath, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

const CWD = process.cwd();
const allowedDirs: string[] = [CWD];

export function getCwd(): string {
  return CWD;
}

export function getAllowedDirs(): readonly string[] {
  return allowedDirs;
}

export async function addAllowedDir(p: string): Promise<string> {
  const abs = resolve(CWD, p);
  const s = await stat(abs);
  if (!s.isDirectory()) throw new Error(`${abs} is not a directory`);
  if (!allowedDirs.includes(abs)) allowedDirs.push(abs);
  return abs;
}

function isInside(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent + sep);
}

/**
 * Resolve a user-supplied path and verify it lives inside an allowed dir.
 * Also follows symlinks via realpath so a symlink inside an allowed dir cannot
 * escape the sandbox by pointing elsewhere on disk.
 */
export async function safePath(p: string): Promise<string> {
  const abs = resolve(CWD, p);

  // The lexical check rejects "../../etc/passwd" before any I/O.
  const lexicallyAllowed = allowedDirs.some((dir) => isInside(abs, dir));
  if (!lexicallyAllowed) {
    throw new Error(
      `Path ${p} is not in any allowed directory. Use /add-dir <path> to allow it.`,
    );
  }

  // Files may not exist yet (write_file creates them). Walk up to the nearest
  // existing ancestor and realpath that.
  const realParent = await realpathOfNearestAncestor(abs);
  const realAllowed = await Promise.all(allowedDirs.map((d) => realpathSafe(d)));
  if (!realAllowed.some((dir) => isInside(realParent, dir))) {
    throw new Error(
      `Path ${p} resolves outside the allowlist via symlink — refusing.`,
    );
  }
  return abs;
}

async function realpathSafe(p: string): Promise<string> {
  try {
    return await realpath(p);
  } catch {
    return p;
  }
}

async function realpathOfNearestAncestor(abs: string): Promise<string> {
  let cur = abs;
  while (cur && cur !== sep) {
    try {
      return await realpath(cur);
    } catch {
      const parent = cur.slice(0, cur.lastIndexOf(sep));
      if (parent === cur || parent === '') return cur;
      cur = parent;
    }
  }
  return cur;
}
