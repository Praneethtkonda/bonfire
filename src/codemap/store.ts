import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { Codemap } from './types.js';

const CACHE_RELATIVE = '.bonfire/codemap.json';

export function cachePath(root: string): string {
  return resolve(root, CACHE_RELATIVE);
}

interface CacheEntry {
  map: Codemap;
  /** mtime of the on-disk JSON when we last parsed it. */
  mtime: number;
}

const memo = new Map<string, CacheEntry>();

/**
 * Read the codemap from disk, returning a cached parse if the on-disk file
 * hasn't changed since we last loaded it. The `stat` is an order of magnitude
 * cheaper than re-parsing a multi-megabyte JSON tree on every navigate call.
 */
export async function loadCodemap(root: string): Promise<Codemap | null> {
  const path = cachePath(root);
  let mtime: number;
  try {
    mtime = (await stat(path)).mtimeMs;
  } catch {
    memo.delete(root);
    return null;
  }
  const hit = memo.get(root);
  if (hit && hit.mtime === mtime) return hit.map;
  try {
    const raw = await readFile(path, 'utf-8');
    const parsed = JSON.parse(raw) as Codemap;
    if (parsed.version !== 1) return null;
    memo.set(root, { map: parsed, mtime });
    return parsed;
  } catch {
    return null;
  }
}

export async function saveCodemap(root: string, map: Codemap): Promise<void> {
  const path = cachePath(root);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(map, null, 2), 'utf-8');
  // Refresh memo with the just-written tree so the next loadCodemap is a hit
  // without a fresh disk read.
  try {
    const mtime = (await stat(path)).mtimeMs;
    memo.set(root, { map, mtime });
  } catch {
    memo.delete(root);
  }
}

/** Drop the in-process cache. Useful for tests and after `/codemap rebuild`. */
export function invalidateCodemapCache(root?: string): void {
  if (root === undefined) memo.clear();
  else memo.delete(root);
}
