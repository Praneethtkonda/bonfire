import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { walkRepo } from '../../src/codemap/walk.js';
import type { CodemapNode } from '../../src/codemap/types.js';

let scratch: string;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'bonfire-walk-'));
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

function findChild(node: CodemapNode, name: string): CodemapNode | undefined {
  return (node.children ?? []).find((c) => c.name === name);
}

function findPath(node: CodemapNode, parts: string[]): CodemapNode | undefined {
  let cur: CodemapNode | undefined = node;
  for (const p of parts) {
    if (!cur) return undefined;
    cur = findChild(cur, p);
  }
  return cur;
}

function listNames(node: CodemapNode): string[] {
  return (node.children ?? []).map((c) => c.name).sort();
}

describe('walkRepo - tree shape', () => {
  it('builds the full tree with files and nested dirs', async () => {
    await mkdir(join(scratch, 'src', 'sub'), { recursive: true });
    await writeFile(join(scratch, 'README.md'), '# hi');
    await writeFile(join(scratch, 'src', 'a.ts'), 'export const a = 1;');
    await writeFile(join(scratch, 'src', 'sub', 'b.ts'), 'export const b = 2;');

    const map = await walkRepo({ root: scratch });
    expect(map.tree.kind).toBe('dir');
    expect(listNames(map.tree)).toEqual(['README.md', 'src']);
    const src = findChild(map.tree, 'src')!;
    expect(listNames(src)).toEqual(['a.ts', 'sub']);
    const sub = findChild(src, 'sub')!;
    expect(listNames(sub)).toEqual(['b.ts']);
  });

  it('records file size and mtime', async () => {
    await writeFile(join(scratch, 'a.txt'), 'hello');
    const map = await walkRepo({ root: scratch });
    const a = findChild(map.tree, 'a.txt')!;
    expect(a.kind).toBe('file');
    expect(a.size).toBe(5);
    expect(typeof a.mtime).toBe('number');
  });

  it('extracts TypeScript exports into the skeleton', async () => {
    await writeFile(
      join(scratch, 'lib.ts'),
      'export function alpha() {}\nexport const beta = 42;\n',
    );
    const map = await walkRepo({ root: scratch });
    const node = findChild(map.tree, 'lib.ts')!;
    expect(node.skeleton).toContain('exports:');
    expect(node.skeleton).toContain('alpha');
    expect(node.skeleton).toContain('beta');
  });
});

describe('walkRepo - .gitignore globs', () => {
  it('respects glob patterns from .gitignore', async () => {
    await mkdir(join(scratch, 'logs'), { recursive: true });
    await mkdir(join(scratch, 'src', 'generated'), { recursive: true });
    await writeFile(join(scratch, '.gitignore'), '*.log\n**/generated/**\n');
    await writeFile(join(scratch, 'logs', 'app.log'), 'noise');
    await writeFile(join(scratch, 'src', 'a.ts'), '');
    await writeFile(join(scratch, 'src', 'generated', 'gen.ts'), '');

    const map = await walkRepo({ root: scratch });
    const logs = findChild(map.tree, 'logs');
    expect(logs).toBeDefined();
    expect(listNames(logs!)).toEqual([]); // *.log filtered out
    const generated = findPath(map.tree, ['src', 'generated']);
    expect(generated).toBeDefined();
    expect(listNames(generated!)).toEqual([]);
  });

  it('honours ! negations', async () => {
    await writeFile(join(scratch, '.gitignore'), '*.log\n!keep.log\n');
    await writeFile(join(scratch, 'noisy.log'), '');
    await writeFile(join(scratch, 'keep.log'), '');

    const map = await walkRepo({ root: scratch });
    expect(listNames(map.tree)).toEqual(['.gitignore', 'keep.log']);
  });

  it('supports anchored / patterns', async () => {
    await mkdir(join(scratch, 'a', 'config'), { recursive: true });
    await writeFile(join(scratch, '.gitignore'), '/config\n');
    await writeFile(join(scratch, 'a', 'config', 'kept.txt'), '');
    await mkdir(join(scratch, 'config'), { recursive: true });
    await writeFile(join(scratch, 'config', 'dropped.txt'), '');

    const map = await walkRepo({ root: scratch });
    expect(findChild(map.tree, 'config')).toBeUndefined();
    expect(findPath(map.tree, ['a', 'config'])).toBeDefined();
  });
});

describe('walkRepo - hidden directories', () => {
  it('includes .github but excludes .git and .bonfire', async () => {
    await mkdir(join(scratch, '.github', 'workflows'), { recursive: true });
    await mkdir(join(scratch, '.git'), { recursive: true });
    await mkdir(join(scratch, '.bonfire'), { recursive: true });
    await writeFile(join(scratch, '.github', 'workflows', 'ci.yml'), 'name: CI');
    await writeFile(join(scratch, '.git', 'HEAD'), 'ref: refs/heads/main');
    await writeFile(join(scratch, '.bonfire', 'state.json'), '{}');

    const map = await walkRepo({ root: scratch });
    expect(findChild(map.tree, '.github')).toBeDefined();
    expect(findChild(map.tree, '.git')).toBeUndefined();
    expect(findChild(map.tree, '.bonfire')).toBeUndefined();
  });
});

describe('walkRepo - symlinks', () => {
  it('skips symlinks regardless of where they point', async () => {
    await mkdir(join(scratch, 'real'), { recursive: true });
    await writeFile(join(scratch, 'real', 'a.txt'), 'hi');
    try {
      await symlink(join(scratch, 'real'), join(scratch, 'link-to-real'));
      await symlink('/etc', join(scratch, 'escape'));
    } catch {
      // No symlink permission on this system; skip silently.
      return;
    }

    const map = await walkRepo({ root: scratch });
    expect(findChild(map.tree, 'link-to-real')).toBeUndefined();
    expect(findChild(map.tree, 'escape')).toBeUndefined();
    expect(findChild(map.tree, 'real')).toBeDefined();
  });
});

describe('walkRepo - cache reuse + staleness', () => {
  it('reuses a file node when mtime+size are unchanged', async () => {
    await writeFile(join(scratch, 'a.ts'), 'export const a = 1;');
    const first = await walkRepo({ root: scratch });
    const aFirst = findChild(first.tree, 'a.ts')!;
    aFirst.summary = 'cached summary';
    aFirst.summarizedAt = Date.now();

    const second = await walkRepo({ root: scratch, previous: first });
    const aSecond = findChild(second.tree, 'a.ts')!;
    expect(aSecond.summary).toBe('cached summary');
  });

  it('keeps the dir summary if no descendant changed', async () => {
    await mkdir(join(scratch, 'src'), { recursive: true });
    await writeFile(join(scratch, 'src', 'a.ts'), 'export const a = 1;');
    const first = await walkRepo({ root: scratch });
    const srcFirst = findChild(first.tree, 'src')!;
    srcFirst.summary = 'src dir summary';
    srcFirst.summarizedAt = Date.now() + 1_000_000;

    const second = await walkRepo({ root: scratch, previous: first });
    const srcSecond = findChild(second.tree, 'src')!;
    expect(srcSecond.summary).toBe('src dir summary');
  });

  it('clears the dir summary when a descendant file is modified after summarizedAt', async () => {
    await mkdir(join(scratch, 'src'), { recursive: true });
    const aPath = join(scratch, 'src', 'a.ts');
    await writeFile(aPath, 'export const a = 1;');
    const first = await walkRepo({ root: scratch });
    const srcFirst = findChild(first.tree, 'src')!;
    srcFirst.summary = 'stale summary';
    srcFirst.summarizedAt = Date.now() - 60_000;

    // Touch the file so its mtime is newer than the dir's summarizedAt.
    const future = new Date(Date.now() + 60_000);
    await utimes(aPath, future, future);

    const second = await walkRepo({ root: scratch, previous: first });
    const srcSecond = findChild(second.tree, 'src')!;
    expect(srcSecond.summary).toBeUndefined();
  });

  it('clears the dir summary when a child file is added', async () => {
    await mkdir(join(scratch, 'src'), { recursive: true });
    await writeFile(join(scratch, 'src', 'a.ts'), '');
    const first = await walkRepo({ root: scratch });
    const srcFirst = findChild(first.tree, 'src')!;
    srcFirst.summary = 'src dir';
    srcFirst.summarizedAt = Date.now() + 1_000_000;

    await writeFile(join(scratch, 'src', 'b.ts'), '');
    const second = await walkRepo({ root: scratch, previous: first });
    const srcSecond = findChild(second.tree, 'src')!;
    expect(srcSecond.summary).toBeUndefined();
  });
});
