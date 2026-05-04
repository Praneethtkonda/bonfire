import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { statsFor, walkRepo } from '../../src/codemap/walk.js';
import type { Codemap, CodemapNode } from '../../src/codemap/types.js';

let scratch: string;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'bonfire-walk-extras-'));
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

function find(node: CodemapNode, name: string): CodemapNode | undefined {
  return (node.children ?? []).find((c) => c.name === name);
}

function findPath(node: CodemapNode, parts: string[]): CodemapNode | undefined {
  let cur: CodemapNode | undefined = node;
  for (const p of parts) {
    if (!cur) return undefined;
    cur = find(cur, p);
  }
  return cur;
}

describe('statsFor', () => {
  it('counts files, dirs, summarized nodes, and total bytes', async () => {
    await mkdir(join(scratch, 'sub'), { recursive: true });
    await writeFile(join(scratch, 'a.ts'), 'export const a = 1;');
    await writeFile(join(scratch, 'sub', 'b.ts'), 'export const b = 2;');
    const map = await walkRepo({ root: scratch });

    // Plant fake summaries on a couple of nodes to test summarized counter.
    find(map.tree, 'a.ts')!.summary = 'a stub';
    find(map.tree, 'sub')!.summary = 'sub stub';

    const stats = statsFor(map);
    expect(stats.files).toBe(2);
    expect(stats.dirs).toBe(2); // root + sub
    expect(stats.summarized).toBe(2);
    expect(stats.bytes).toBeGreaterThan(0);
  });

  it('reports 0 stats for an empty repo', async () => {
    const map: Codemap = {
      version: 1,
      root: scratch,
      builtAt: 0,
      summarizedAt: 0,
      tree: { path: '', name: '.', kind: 'dir', skeleton: 'empty', children: [] },
    };
    const stats = statsFor(map);
    expect(stats).toEqual({ files: 0, dirs: 1, summarized: 0, bytes: 0 });
  });
});

describe('export extraction by language', () => {
  it('extracts Python def/class names, ignoring underscored', async () => {
    await writeFile(
      join(scratch, 'mod.py'),
      [
        'def public_fn(x):',
        '    return x',
        '',
        'class Public:',
        '    pass',
        '',
        'def _private():',
        '    pass',
      ].join('\n'),
    );
    const map = await walkRepo({ root: scratch });
    const node = find(map.tree, 'mod.py')!;
    expect(node.skeleton).toContain('exports:');
    expect(node.skeleton).toContain('public_fn');
    expect(node.skeleton).toContain('Public');
    expect(node.skeleton).not.toContain('_private');
  });

  it('extracts Rust pub items', async () => {
    await writeFile(
      join(scratch, 'lib.rs'),
      [
        'pub fn alpha() {}',
        'pub struct Beta;',
        'pub enum Gamma { A, B }',
        'pub trait Delta {}',
        'fn private_fn() {}',
      ].join('\n'),
    );
    const map = await walkRepo({ root: scratch });
    const node = find(map.tree, 'lib.rs')!;
    expect(node.skeleton).toContain('alpha');
    expect(node.skeleton).toContain('Beta');
    expect(node.skeleton).toContain('Gamma');
    expect(node.skeleton).toContain('Delta');
    expect(node.skeleton).not.toContain('private_fn');
  });

  it('extracts Go top-level uppercase func names', async () => {
    await writeFile(
      join(scratch, 'main.go'),
      [
        'package main',
        '',
        'func PublicFunc() {}',
        'func privateFunc() {}',
        'func (s *Server) Method() {}',
      ].join('\n'),
    );
    const map = await walkRepo({ root: scratch });
    const node = find(map.tree, 'main.go')!;
    expect(node.skeleton).toContain('PublicFunc');
    expect(node.skeleton).toContain('Method');
    expect(node.skeleton).not.toContain('privateFunc');
  });

  it('extracts TS export { a, b } lists', async () => {
    await writeFile(
      join(scratch, 'idx.ts'),
      'const a = 1; const b = 2; const c = 3;\nexport { a, b, c };',
    );
    const map = await walkRepo({ root: scratch });
    const node = find(map.tree, 'idx.ts')!;
    expect(node.skeleton).toContain('exports:');
    expect(node.skeleton).toContain('a');
    expect(node.skeleton).toContain('b');
    expect(node.skeleton).toContain('c');
  });

  it('captures the original name from "export { x as y }" (alias dropped)', async () => {
    await writeFile(
      join(scratch, 'alias.ts'),
      'const internal = 1;\nexport { internal as renamed };',
    );
    const map = await walkRepo({ root: scratch });
    const node = find(map.tree, 'alias.ts')!;
    expect(node.skeleton).toContain('internal');
  });

  it('caps the number of exports surfaced in the skeleton', async () => {
    const lines = Array.from(
      { length: 15 },
      (_, i) => `export const v${i} = ${i};`,
    ).join('\n');
    await writeFile(join(scratch, 'many.ts'), lines);
    const map = await walkRepo({ root: scratch });
    const node = find(map.tree, 'many.ts')!;
    // Only first six are listed in the skeleton.
    expect(node.skeleton).toContain('v0');
    expect(node.skeleton).toContain('v5');
    expect(node.skeleton).not.toContain('v6');
  });
});

describe('top-comment extraction', () => {
  it('captures a /** block */ doc comment at the top', async () => {
    await writeFile(
      join(scratch, 'doc.ts'),
      [
        '/**',
        ' * Handles JWT signing and verification.',
        ' */',
        'export function sign() {}',
      ].join('\n'),
    );
    const map = await walkRepo({ root: scratch });
    const node = find(map.tree, 'doc.ts')!;
    expect(node.skeleton).toContain('JWT signing and verification');
  });

  it('captures a run of // line comments at the top', async () => {
    await writeFile(
      join(scratch, 'lines.ts'),
      [
        '// Library entry point.',
        '// Sets up the public surface.',
        'export const x = 1;',
      ].join('\n'),
    );
    const map = await walkRepo({ root: scratch });
    const node = find(map.tree, 'lines.ts')!;
    expect(node.skeleton).toContain('Library entry point');
  });

  it('skips a shebang line when looking for # comments', async () => {
    await writeFile(
      join(scratch, 'script.sh'),
      [
        '#!/usr/bin/env bash',
        '# Build helper for the docs site.',
        'echo hi',
      ].join('\n'),
    );
    const map = await walkRepo({ root: scratch });
    const node = find(map.tree, 'script.sh')!;
    expect(node.skeleton).toContain('Build helper for the docs site');
  });
});

describe('large files', () => {
  it('marks files over the threshold with a (large) skeleton but still lets them be summarized', async () => {
    const huge = 'x = 1;\n'.repeat(120_000); // > 500 KB
    await writeFile(join(scratch, 'big.ts'), huge);
    const map = await walkRepo({ root: scratch });
    const node = find(map.tree, 'big.ts')!;
    expect(node.skeleton).toContain('(large)');
    expect(node.skeleton).toContain('KB');
    // Large files keep size + mtime so the summarization pass can still run.
    expect(node.size).toBeGreaterThan(500_000);
  });
});

describe('skeleton size formatting', () => {
  it('uses bytes for very small files', async () => {
    await writeFile(join(scratch, 'tiny.ts'), 'x');
    const map = await walkRepo({ root: scratch });
    const node = find(map.tree, 'tiny.ts')!;
    expect(node.skeleton).toContain(' B');
  });

  it('uses KB for files >= 1 KB', async () => {
    await writeFile(join(scratch, 'mid.ts'), 'a'.repeat(2048));
    const map = await walkRepo({ root: scratch });
    const node = find(map.tree, 'mid.ts')!;
    expect(node.skeleton).toMatch(/\d\.\d KB/);
  });
});

describe('directory skeleton aggregation', () => {
  it('summarizes child counts and top extensions', async () => {
    await mkdir(join(scratch, 'sub'), { recursive: true });
    await writeFile(join(scratch, 'a.ts'), '');
    await writeFile(join(scratch, 'b.ts'), '');
    await writeFile(join(scratch, 'c.md'), '');
    const map = await walkRepo({ root: scratch });
    expect(map.tree.skeleton).toContain('1 dir');
    expect(map.tree.skeleton).toContain('3 files');
    expect(map.tree.skeleton).toContain('2 .ts');
    expect(map.tree.skeleton).toContain('1 .md');
  });

  it('reports "empty" for empty dirs', async () => {
    await mkdir(join(scratch, 'empty'), { recursive: true });
    const map = await walkRepo({ root: scratch });
    const empty = findPath(map.tree, ['empty'])!;
    expect(empty.skeleton).toBe('empty');
  });
});
