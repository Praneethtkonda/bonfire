import { describe, expect, it } from 'vitest';
import { findNode, navigateCodemap } from '../../src/codemap/index.js';
import type { Codemap, CodemapNode } from '../../src/codemap/types.js';

function file(path: string, summary?: string): CodemapNode {
  const name = path.split('/').pop() ?? path;
  return {
    path,
    name,
    kind: 'file',
    skeleton: `TS · 10 LOC`,
    summary,
  };
}

function dir(path: string, name: string, children: CodemapNode[], summary?: string): CodemapNode {
  return {
    path,
    name,
    kind: 'dir',
    skeleton: `${children.length} files`,
    summary,
    children,
  };
}

function fixture(): Codemap {
  const tree = dir('', '.', [
    dir('src', 'src', [
      file('index.ts', 'entry point'),
      dir('src/util', 'util', [file('src/util/log.ts', 'logger')], 'utilities'),
    ], 'TypeScript source'),
    file('README.md', 'readme'),
  ]);
  return {
    version: 1,
    root: '/repo',
    builtAt: 0,
    summarizedAt: 0,
    tree,
  };
}

describe('findNode', () => {
  it('returns the root for "" / "." / "/"', () => {
    const map = fixture();
    expect(findNode(map.tree, '')).toBe(map.tree);
    expect(findNode(map.tree, '.')).toBe(map.tree);
    expect(findNode(map.tree, '/')).toBe(map.tree);
  });

  it('descends into subdirectories', () => {
    const map = fixture();
    const node = findNode(map.tree, 'src');
    expect(node?.kind).toBe('dir');
    expect(node?.name).toBe('src');
  });

  it('returns nested file', () => {
    const map = fixture();
    const node = findNode(map.tree, 'src/util/log.ts');
    expect(node?.kind).toBe('file');
    expect(node?.summary).toBe('logger');
  });

  it('returns undefined for missing paths', () => {
    const map = fixture();
    expect(findNode(map.tree, 'nope')).toBeUndefined();
    expect(findNode(map.tree, 'src/missing.ts')).toBeUndefined();
  });

  it('returns undefined when descending into a file', () => {
    const map = fixture();
    expect(findNode(map.tree, 'README.md/whatever')).toBeUndefined();
  });
});

describe('navigateCodemap', () => {
  it('returns a directory with its direct children only', () => {
    const map = fixture();
    const result = navigateCodemap(map, 'src');
    expect(result.kind).toBe('dir');
    expect(result.summary).toBe('TypeScript source');
    expect(result.children).toBeDefined();
    expect(result.children!.map((c) => c.name).sort()).toEqual(['index.ts', 'util']);
    // Grandchildren not included.
    const utilEntry = result.children!.find((c) => c.name === 'util')!;
    expect((utilEntry as { children?: unknown }).children).toBeUndefined();
  });

  it('returns a file shape (no children) for a file path', () => {
    const map = fixture();
    const result = navigateCodemap(map, 'README.md');
    expect(result.kind).toBe('file');
    expect(result.summary).toBe('readme');
    expect(result.children).toBeUndefined();
  });

  it('normalizes leading "./" and "/"', () => {
    const map = fixture();
    expect(navigateCodemap(map, './src').path).toBe('src');
    expect(navigateCodemap(map, '/src').path).toBe('src');
  });

  it('normalizes trailing slash', () => {
    const map = fixture();
    expect(navigateCodemap(map, 'src/').path).toBe('src');
  });

  it('normalizes Windows-style backslashes', () => {
    const map = fixture();
    expect(navigateCodemap(map, 'src\\util').path).toBe('src/util');
  });

  it('returns an error result when the path is not in the codemap', () => {
    const map = fixture();
    const result = navigateCodemap(map, 'no-such-dir');
    expect(result.error).toMatch(/not found/);
    expect(result.kind).toBe('dir');
  });
});
