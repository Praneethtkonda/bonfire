import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { Codemap } from './types.js';

const CACHE_RELATIVE = '.bonfire/codemap.json';

export function cachePath(root: string): string {
  return resolve(root, CACHE_RELATIVE);
}

export async function loadCodemap(root: string): Promise<Codemap | null> {
  const path = cachePath(root);
  try {
    const raw = await readFile(path, 'utf-8');
    const parsed = JSON.parse(raw) as Codemap;
    if (parsed.version !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function saveCodemap(root: string, map: Codemap): Promise<void> {
  const path = cachePath(root);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(map, null, 2), 'utf-8');
}
