import { invalidateCodemapCache, loadCodemap, saveCodemap } from './store.js';
import { summarizeCodemap, type SummarizeOptions } from './summarize.js';
import type { Codemap, CodemapNode, CodemapStats } from './types.js';
import { statsFor, walkRepo } from './walk.js';

export type { Codemap, CodemapNode, CodemapStats } from './types.js';
export { statsFor } from './walk.js';
export { invalidateCodemapCache } from './store.js';

/**
 * Load the cached codemap, or walk the repo to build a skeleton map if nothing
 * is cached / the cache is stale. Does NOT run an LLM pass — call `buildSummaries`
 * separately for that.
 */
export async function ensureCodemap(root: string): Promise<Codemap> {
  const cached = await loadCodemap(root);
  if (cached && cached.root === root) {
    // Re-walk to pick up filesystem changes; existing nodes are reused via mtime match.
    const fresh = await walkRepo({ root, previous: cached });
    if (codemapsDiffer(cached, fresh)) await saveCodemap(root, fresh);
    return fresh;
  }
  const fresh = await walkRepo({ root });
  await saveCodemap(root, fresh);
  return fresh;
}

/**
 * Run the LLM summarization pass over the current codemap.
 * Returns the updated map (already persisted to disk).
 */
export async function buildSummaries(
  root: string,
  options?: SummarizeOptions,
): Promise<Codemap> {
  const map = await ensureCodemap(root);
  await summarizeCodemap(map, options);
  await saveCodemap(root, map);
  return map;
}

/** Force a full fresh walk and throw away any cached summaries. */
export async function rebuildCodemap(root: string): Promise<Codemap> {
  invalidateCodemapCache(root);
  const fresh = await walkRepo({ root });
  await saveCodemap(root, fresh);
  return fresh;
}

export interface NavigateResult {
  path: string;
  kind: 'dir' | 'file';
  summary?: string;
  skeleton: string;
  children?: Array<{
    name: string;
    path: string;
    kind: 'dir' | 'file';
    summary?: string;
    skeleton: string;
  }>;
  error?: string;
}

/**
 * Return the requested node plus — for directories — its direct children with
 * summaries. The model uses this to traverse the repo without reading source.
 */
export function navigateCodemap(map: Codemap, requestedPath: string): NavigateResult {
  const normalized = normalizePath(requestedPath);
  const node = findNode(map.tree, normalized);
  if (!node) {
    return {
      path: normalized,
      kind: 'dir',
      skeleton: '',
      error: `path not found in codemap: ${requestedPath}`,
    };
  }
  if (node.kind === 'file') {
    return {
      path: node.path,
      kind: 'file',
      summary: node.summary,
      skeleton: node.skeleton,
    };
  }
  return {
    path: node.path,
    kind: 'dir',
    summary: node.summary,
    skeleton: node.skeleton,
    children: (node.children ?? []).map((c) => ({
      name: c.name,
      path: c.path,
      kind: c.kind,
      summary: c.summary,
      skeleton: c.skeleton,
    })),
  };
}

export function findNode(tree: CodemapNode, path: string): CodemapNode | undefined {
  if (path === '' || path === '.' || path === '/') return tree;
  const parts = path.split('/').filter(Boolean);
  let cur: CodemapNode | undefined = tree;
  for (const part of parts) {
    if (!cur || cur.kind !== 'dir') return undefined;
    cur = (cur.children ?? []).find((c) => c.name === part);
  }
  return cur;
}

function normalizePath(raw: string): string {
  if (!raw) return '';
  let p = raw.replace(/\\/g, '/');
  // Strip leading ./ and /
  p = p.replace(/^\.\/+/, '').replace(/^\/+/, '');
  p = p.replace(/\/+$/, '');
  if (p === '.' || p === '') return '';
  return p;
}

function codemapsDiffer(a: Codemap, b: Codemap): boolean {
  const sa = statsFor(a);
  const sb = statsFor(b);
  return sa.files !== sb.files || sa.dirs !== sb.dirs || sa.bytes !== sb.bytes;
}

/** Convenience re-export so callers can compute stats off a loaded map. */
export async function codemapStats(root: string): Promise<CodemapStats | null> {
  const map = await loadCodemap(root);
  return map ? statsFor(map) : null;
}
