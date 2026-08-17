import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { globToRegExp, searchRepo } from '../../src/tools/search-tool.js';

describe('globToRegExp', () => {
  it('matches a bare extension pattern at any depth', () => {
    const re = globToRegExp('*.ts');
    expect(re.test('index.ts')).toBe(true);
    expect(re.test('src/deep/index.ts')).toBe(true);
    expect(re.test('index.tsx')).toBe(false);
  });

  it('anchors a pattern that contains a slash', () => {
    const re = globToRegExp('src/*.ts');
    expect(re.test('src/index.ts')).toBe(true);
    expect(re.test('src/deep/index.ts')).toBe(false);
    expect(re.test('lib/src/index.ts')).toBe(false);
  });

  it('spans directories with **/', () => {
    const re = globToRegExp('src/**/*.test.ts');
    expect(re.test('src/a.test.ts')).toBe(true);
    expect(re.test('src/a/b/c.test.ts')).toBe(true);
    expect(re.test('other/a.test.ts')).toBe(false);
  });

  it('treats ? as a single non-separator character', () => {
    const re = globToRegExp('a?.ts');
    expect(re.test('ab.ts')).toBe(true);
    expect(re.test('abc.ts')).toBe(false);
  });

  it('escapes regex metacharacters in literal segments', () => {
    const re = globToRegExp('a+b.ts');
    expect(re.test('a+b.ts')).toBe(true);
    expect(re.test('aab.ts')).toBe(false);
  });
});

describe('searchRepo', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'bonfire-search-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const write = (rel: string, content: string | Buffer) => {
    const abs = join(root, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
  };

  it('finds matches with paths and line numbers', async () => {
    write('src/a.ts', 'const x = 1;\nexport function target() {}\n');
    const result = await searchRepo({ pattern: 'target', root });
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].path).toBe('src/a.ts');
    expect(result.matches[0].line).toBe(2);
    expect(result.matches[0].text).toContain('target');
  });

  it('is case-insensitive by default and exact when asked', async () => {
    write('a.ts', 'TARGET\n');
    expect((await searchRepo({ pattern: 'target', root })).matches).toHaveLength(1);
    expect(
      (await searchRepo({ pattern: 'target', root, caseSensitive: true })).matches,
    ).toHaveLength(0);
  });

  it('honours the glob filter', async () => {
    write('a.ts', 'needle\n');
    write('b.md', 'needle\n');
    const result = await searchRepo({ pattern: 'needle', root, glob: '*.ts' });
    expect(result.matches.map((m) => m.path)).toEqual(['a.ts']);
  });

  it('honours .gitignore', async () => {
    write('.gitignore', 'secret.txt\nbuild/\n');
    write('secret.txt', 'needle\n');
    write('build/out.js', 'needle\n');
    write('keep.txt', 'needle\n');
    const result = await searchRepo({ pattern: 'needle', root });
    expect(result.matches.map((m) => m.path)).toEqual(['keep.txt']);
  });

  it('skips node_modules and .git', async () => {
    write('node_modules/pkg/index.js', 'needle\n');
    write('.git/config', 'needle\n');
    write('a.ts', 'needle\n');
    const result = await searchRepo({ pattern: 'needle', root });
    expect(result.matches.map((m) => m.path)).toEqual(['a.ts']);
  });

  it('skips binary files', async () => {
    write('bin.dat', Buffer.from([0x6e, 0x65, 0x00, 0x65, 0x64, 0x6c, 0x65]));
    write('a.ts', 'needle\n');
    const result = await searchRepo({ pattern: 'ne', root });
    expect(result.matches.every((m) => m.path === 'a.ts')).toBe(true);
  });

  it('caps the number of matches and reports truncation', async () => {
    write('a.ts', 'needle\n'.repeat(50));
    const result = await searchRepo({ pattern: 'needle', root, maxMatches: 5 });
    expect(result.matches).toHaveLength(5);
    expect(result.truncated).toBe(true);
  });

  it('truncates very long matching lines', async () => {
    write('a.ts', `needle${'x'.repeat(2000)}\n`);
    const result = await searchRepo({ pattern: 'needle', root });
    expect(result.matches[0].text.length).toBeLessThan(600);
    expect(result.matches[0].text.endsWith('…')).toBe(true);
  });

  it('reports an invalid regex instead of throwing', async () => {
    const result = await searchRepo({ pattern: '([unclosed', root });
    expect(result.error).toContain('invalid regex');
    expect(result.matches).toEqual([]);
  });

  it('returns no matches for an empty directory', async () => {
    const result = await searchRepo({ pattern: 'anything', root });
    expect(result.matches).toEqual([]);
    expect(result.filesScanned).toBe(0);
  });
});
