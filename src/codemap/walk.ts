import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, relative, resolve } from 'node:path';
import { isIgnoredDir, isIgnoredFile, loadIgnoreRules, type IgnoreRules } from './ignore.js';
import type { Codemap, CodemapNode, CodemapStats } from './types.js';

const MAX_READ_BYTES = 64_000;          // only read the top of a file for skeleton extraction
const LARGE_FILE_THRESHOLD = 500_000;   // files bigger than this get a size-only skeleton

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
   * If a prior codemap exists, nodes whose mtime + size match are reused — we
   * keep both the skeleton and any LLM summary instead of re-reading the file.
   */
  previous?: Codemap | null;
}

export async function walkRepo(options: WalkOptions): Promise<Codemap> {
  const rules = await loadIgnoreRules(options.root);
  const prevIndex = options.previous ? buildPrevIndex(options.previous.tree) : new Map<string, CodemapNode>();
  const tree = await walkNode('', options.root, rules, prevIndex);
  return {
    version: 1,
    root: options.root,
    builtAt: Date.now(),
    summarizedAt: options.previous?.summarizedAt ?? 0,
    tree,
  };
}

function buildPrevIndex(node: CodemapNode, into = new Map<string, CodemapNode>()): Map<string, CodemapNode> {
  into.set(node.path, node);
  for (const child of node.children ?? []) buildPrevIndex(child, into);
  return into;
}

async function walkNode(
  relPath: string,
  abs: string,
  rules: IgnoreRules,
  prev: Map<string, CodemapNode>,
): Promise<CodemapNode> {
  const name = relPath === '' ? '.' : relPath.split('/').pop()!;
  let entries: string[] = [];
  try {
    entries = await readdir(abs);
  } catch {
    entries = [];
  }

  const children: CodemapNode[] = [];
  for (const entry of entries.sort()) {
    const childAbs = resolve(abs, entry);
    let s;
    try {
      s = await stat(childAbs);
    } catch {
      continue;
    }
    const childRel = relPath === '' ? entry : `${relPath}/${entry}`;
    if (s.isDirectory()) {
      if (isIgnoredDir(entry, rules)) continue;
      children.push(await walkNode(childRel, childAbs, rules, prev));
    } else if (s.isFile()) {
      if (isIgnoredFile(entry, rules)) continue;
      children.push(await visitFile(childRel, childAbs, s.mtimeMs, s.size, prev));
    }
  }

  return {
    path: relPath,
    name,
    kind: 'dir',
    skeleton: skeletonForDir(children),
    // Roll forward a cached dir summary if children are structurally unchanged.
    summary: inheritDirSummary(relPath, children, prev),
    children,
  };
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
    return {
      path: relPath,
      name,
      kind: 'file',
      skeleton: `${langFromName(name)} · ${(size / 1024).toFixed(0)} KB (large, skipped)`,
      size,
      mtime,
    };
  }

  let head = '';
  try {
    const buf = await readFile(abs);
    head = buf.subarray(0, MAX_READ_BYTES).toString('utf-8');
  } catch {
    head = '';
  }

  return {
    path: relPath,
    name,
    kind: 'file',
    skeleton: skeletonForFile(name, head, size),
    size,
    mtime,
  };
}

function inheritDirSummary(
  relPath: string,
  children: CodemapNode[],
  prev: Map<string, CodemapNode>,
): string | undefined {
  const cached = prev.get(relPath);
  if (!cached || cached.kind !== 'dir' || !cached.summary) return undefined;
  const prevChildNames = new Set((cached.children ?? []).map((c) => c.name));
  const nextChildNames = new Set(children.map((c) => c.name));
  if (prevChildNames.size !== nextChildNames.size) return undefined;
  for (const n of nextChildNames) if (!prevChildNames.has(n)) return undefined;
  return cached.summary;
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
