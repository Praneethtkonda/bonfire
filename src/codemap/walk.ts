import { lstat, readdir, readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { isIgnoredDir, isIgnoredFile, loadIgnoreRules } from './ignore.js';
import type { Codemap, CodemapNode, CodemapStats } from './types.js';

const MAX_READ_BYTES = 64_000;          // skeleton head budget per file
const LARGE_FILE_THRESHOLD = 500_000;   // export-extraction cutoff; LLM still summarizes head

const LANG_BY_EXT: Record<string, string> = {
  '.ts': 'TS', '.tsx': 'TSX', '.js': 'JS', '.jsx': 'JSX', '.mjs': 'JS', '.cjs': 'JS',
  '.py': 'Py', '.rs': 'Rust', '.go': 'Go', '.java': 'Java', '.kt': 'Kotlin',
  '.rb': 'Ruby', '.php': 'PHP', '.cs': 'C#', '.swift': 'Swift', '.scala': 'Scala',
  '.c': 'C', '.h': 'C', '.cc': 'C++', '.cpp': 'C++', '.hpp': 'C++', '.hh': 'C++',
  '.sh': 'Shell', '.bash': 'Shell', '.zsh': 'Shell', '.ps1': 'PowerShell',
  '.md': 'MD', '.mdx': 'MDX', '.json': 'JSON', '.yaml': 'YAML', '.yml': 'YAML',
  '.toml': 'TOML', '.sql': 'SQL', '.html': 'HTML', '.css': 'CSS', '.scss': 'SCSS',
  '.proto': 'Proto', '.graphql': 'GraphQL', '.vue': 'Vue', '.svelte': 'Svelte',
};

export interface WalkOptions {
  root: string;
  /**
   * Reuse skeletons + summaries from a prior codemap whenever a node's
   * mtime+size still match. Symlinks are skipped entirely.
   */
  previous?: Codemap | null;
}

interface QueueEntry {
  relPath: string;
  abs: string;
  node: CodemapNode;
}

/**
 * Iteratively walk the repo breadth-first. Builds the tree top-down: each dir
 * node is created when popped from the queue and its children are attached as
 * they get visited. Once the queue empties, a single post-pass fixes up dir
 * skeletons and propagates cached summaries (clearing any whose subtree has
 * changed since they were summarized).
 */
export async function walkRepo(options: WalkOptions): Promise<Codemap> {
  const rules = await loadIgnoreRules(options.root);
  const prevIndex = options.previous
    ? buildPrevIndex(options.previous.tree)
    : new Map<string, CodemapNode>();

  const tree: CodemapNode = {
    path: '',
    name: '.',
    kind: 'dir',
    skeleton: '',
    children: [],
  };

  const queue: QueueEntry[] = [{ relPath: '', abs: options.root, node: tree }];
  let head = 0;
  while (head < queue.length) {
    const { relPath, abs, node } = queue[head++];
    let entries: string[];
    try {
      entries = await readdir(abs);
    } catch {
      continue;
    }
    for (const name of entries.sort()) {
      const childAbs = resolve(abs, name);
      let s;
      try {
        s = await lstat(childAbs);
      } catch {
        continue;
      }
      if (s.isSymbolicLink()) continue; // never follow — avoids cycles + escapes
      const childRel = relPath === '' ? name : `${relPath}/${name}`;
      if (s.isDirectory()) {
        if (isIgnoredDir(childRel, rules)) continue;
        const child: CodemapNode = {
          path: childRel,
          name,
          kind: 'dir',
          skeleton: '',
          children: [],
        };
        node.children!.push(child);
        queue.push({ relPath: childRel, abs: childAbs, node: child });
      } else if (s.isFile()) {
        if (isIgnoredFile(childRel, rules)) continue;
        const child = await visitFile(childRel, childAbs, s.mtimeMs, s.size, prevIndex);
        node.children!.push(child);
      }
    }
  }

  postProcessTree(tree, prevIndex);

  return {
    version: 1,
    root: options.root,
    builtAt: Date.now(),
    summarizedAt: options.previous?.summarizedAt ?? 0,
    tree,
  };
}

function buildPrevIndex(
  node: CodemapNode,
  into = new Map<string, CodemapNode>(),
): Map<string, CodemapNode> {
  into.set(node.path, node);
  for (const child of node.children ?? []) buildPrevIndex(child, into);
  return into;
}

async function visitFile(
  relPath: string,
  abs: string,
  mtime: number,
  size: number,
  prev: Map<string, CodemapNode>,
): Promise<CodemapNode> {
  const cached = prev.get(relPath);
  if (cached && cached.kind === 'file' && cached.mtime === mtime && cached.size === size) {
    return cached;
  }

  const name = relPath.split('/').pop()!;
  if (size > LARGE_FILE_THRESHOLD) {
    // Big files keep a size-only skeleton (no export extraction), but the
    // summarize pass will still try to write a summary from the head bytes.
    return {
      path: relPath,
      name,
      kind: 'file',
      skeleton: `${langFromName(name)} · ${(size / 1024).toFixed(0)} KB (large)`,
      size,
      mtime,
    };
  }

  const head = await readHead(abs, MAX_READ_BYTES);
  return {
    path: relPath,
    name,
    kind: 'file',
    skeleton: skeletonForFile(name, head, size),
    size,
    mtime,
  };
}

/**
 * Read up to `maxBytes` of `abs` and decode as UTF-8 with stream:true so any
 * trailing partial codepoint is dropped instead of becoming U+FFFD.
 */
async function readHead(abs: string, maxBytes: number): Promise<string> {
  try {
    const buf = await readFile(abs);
    const slice = buf.subarray(0, maxBytes);
    const decoder = new TextDecoder('utf-8', { fatal: false });
    return decoder.decode(slice, { stream: true });
  } catch {
    return '';
  }
}

/**
 * Bottom-up post-pass: recompute every dir's skeleton from its actual children
 * and decide whether to keep the dir's cached summary. The cached summary is
 * preserved only if the structural shape (child names) is unchanged AND no
 * descendant file has been modified since the summary was written.
 */
function postProcessTree(root: CodemapNode, prev: Map<string, CodemapNode>): void {
  function visit(node: CodemapNode): number {
    if (node.kind === 'file') return node.mtime ?? 0;
    let maxDescendantMtime = 0;
    for (const c of node.children ?? []) {
      maxDescendantMtime = Math.max(maxDescendantMtime, visit(c));
    }
    node.skeleton = skeletonForDir(node.children ?? []);

    const cached = prev.get(node.path);
    if (
      cached?.kind === 'dir' &&
      cached.summary &&
      typeof cached.summarizedAt === 'number' &&
      sameChildNames(cached.children ?? [], node.children ?? []) &&
      maxDescendantMtime <= cached.summarizedAt
    ) {
      node.summary = cached.summary;
      node.summarizedAt = cached.summarizedAt;
    }
    return maxDescendantMtime;
  }
  visit(root);
}

function sameChildNames(a: CodemapNode[], b: CodemapNode[]): boolean {
  if (a.length !== b.length) return false;
  const seen = new Set(a.map((n) => n.name));
  for (const n of b) if (!seen.has(n.name)) return false;
  return true;
}

function langFromName(name: string): string {
  return LANG_BY_EXT[extname(name).toLowerCase()] ?? 'file';
}

function skeletonForDir(children: CodemapNode[]): string {
  const byKind = { file: 0, dir: 0 };
  const byExt = new Map<string, number>();
  for (const c of children) {
    byKind[c.kind] += 1;
    if (c.kind === 'file') {
      const ext = extname(c.name).toLowerCase() || '(none)';
      byExt.set(ext, (byExt.get(ext) ?? 0) + 1);
    }
  }
  const extSummary = [...byExt.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([e, n]) => `${n} ${e}`)
    .join(', ');
  const parts: string[] = [];
  if (byKind.dir) parts.push(`${byKind.dir} dir${byKind.dir === 1 ? '' : 's'}`);
  if (byKind.file) parts.push(`${byKind.file} file${byKind.file === 1 ? '' : 's'}`);
  if (extSummary) parts.push(extSummary);
  return parts.join(' · ') || 'empty';
}

function skeletonForFile(name: string, head: string, size: number): string {
  const lang = langFromName(name);
  const loc = head ? head.split('\n').length : 0;
  const exports = extractExports(name, head).slice(0, 6);
  const topComment = extractTopComment(head);
  const parts: string[] = [`${lang} · ${loc} LOC`];
  if (size > 0 && size < 1024) parts.push(`${size} B`);
  else if (size > 0) parts.push(`${(size / 1024).toFixed(1)} KB`);
  if (exports.length) parts.push(`exports: ${exports.join(', ')}`);
  if (topComment) parts.push(`"${truncate(topComment, 90)}"`);
  return parts.join(' · ');
}

function extractExports(name: string, source: string): string[] {
  if (!source) return [];
  const ext = extname(name).toLowerCase();
  const out = new Set<string>();

  if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext)) {
    const re = /export\s+(?:default\s+)?(?:async\s+)?(?:function|const|let|var|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/g;
    for (const m of source.matchAll(re)) out.add(m[1]);
    const re2 = /export\s*\{\s*([^}]+)\s*\}/g;
    for (const m of source.matchAll(re2)) {
      for (const raw of m[1].split(',')) {
        const id = raw.trim().split(/\s+as\s+/)[0].trim();
        if (/^[A-Za-z_$][\w$]*$/.test(id)) out.add(id);
      }
    }
  } else if (ext === '.py') {
    const re = /^(?:def|class)\s+([A-Za-z_][\w]*)/gm;
    for (const m of source.matchAll(re)) {
      if (!m[1].startsWith('_')) out.add(m[1]);
    }
  } else if (ext === '.rs') {
    const re = /\bpub\s+(?:async\s+)?(?:fn|struct|enum|trait|const|static|type)\s+([A-Za-z_][\w]*)/g;
    for (const m of source.matchAll(re)) out.add(m[1]);
  } else if (ext === '.go') {
    const re = /^func\s+(?:\([^)]+\)\s*)?([A-Z][\w]*)/gm;
    for (const m of source.matchAll(re)) out.add(m[1]);
  }

  return [...out];
}

function extractTopComment(source: string): string | undefined {
  if (!source) return undefined;
  const lines = source.split('\n').slice(0, 20);
  // /** ... */ or /* ... */
  const blockStart = lines.findIndex((l) => /^\s*\/\*\*?/.test(l));
  if (blockStart !== -1) {
    const blockEnd = lines.findIndex((l, i) => i >= blockStart && /\*\//.test(l));
    if (blockEnd !== -1) {
      const body = lines
        .slice(blockStart, blockEnd + 1)
        .join(' ')
        .replace(/\/\*+|\*+\/|^\s*\*\s?/gm, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (body) return body;
    }
  }
  // run of `//` or `#` lines
  const lineComments: string[] = [];
  for (const l of lines) {
    const m = l.match(/^\s*(?:\/\/|#)\s?(.*)$/);
    if (m) lineComments.push(m[1]);
    else if (lineComments.length > 0) break;
    else if (l.trim() !== '' && !l.startsWith('#!')) break;
  }
  if (lineComments.length) return lineComments.join(' ').trim();
  return undefined;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

export function statsFor(map: Codemap): CodemapStats {
  const stats: CodemapStats = { files: 0, dirs: 0, summarized: 0, bytes: 0 };
  const visit = (n: CodemapNode) => {
    if (n.kind === 'dir') stats.dirs += 1;
    else {
      stats.files += 1;
      stats.bytes += n.size ?? 0;
    }
    if (n.summary) stats.summarized += 1;
    for (const c of n.children ?? []) visit(c);
  };
  visit(map.tree);
  return stats;
}
