import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  isIgnoredDir,
  isIgnoredFile,
  loadIgnoreRules,
  type IgnoreRules,
} from '../../src/codemap/ignore.js';

let scratch: string;
let rules: IgnoreRules;

async function loadWith(gitignore?: string): Promise<IgnoreRules> {
  if (gitignore !== undefined) {
    await writeFile(join(scratch, '.gitignore'), gitignore, 'utf-8');
  }
  return loadIgnoreRules(scratch);
}

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'bonfire-ignore-'));
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe('curated default ignores', () => {
  beforeEach(async () => {
    rules = await loadWith();
  });

  it('ignores common build/cache dirs at any depth', () => {
    expect(isIgnoredDir('node_modules', rules)).toBe(true);
    expect(isIgnoredDir('src/node_modules', rules)).toBe(true);
    expect(isIgnoredDir('.git', rules)).toBe(true);
    expect(isIgnoredDir('dist', rules)).toBe(true);
    expect(isIgnoredDir('build', rules)).toBe(true);
    expect(isIgnoredDir('coverage', rules)).toBe(true);
    expect(isIgnoredDir('.bonfire', rules)).toBe(true);
  });

  it('does not ignore .github / .config / .cargo', () => {
    expect(isIgnoredDir('.github', rules)).toBe(false);
    expect(isIgnoredDir('.config', rules)).toBe(false);
    expect(isIgnoredDir('.cargo', rules)).toBe(false);
  });

  it('ignores common lockfiles', () => {
    expect(isIgnoredFile('package-lock.json', rules)).toBe(true);
    expect(isIgnoredFile('yarn.lock', rules)).toBe(true);
    expect(isIgnoredFile('Cargo.lock', rules)).toBe(true);
    expect(isIgnoredFile('.DS_Store', rules)).toBe(true);
  });

  it('ignores binary extensions', () => {
    expect(isIgnoredFile('image.png', rules)).toBe(true);
    expect(isIgnoredFile('a/b/icon.svg', rules)).toBe(true);
    expect(isIgnoredFile('FONT.WOFF2', rules)).toBe(true); // case-insensitive
    expect(isIgnoredFile('archive.tar.gz', rules)).toBe(true);
    expect(isIgnoredFile('build/main.min.js', rules)).toBe(true);
  });

  it('does not ignore source files', () => {
    expect(isIgnoredFile('src/index.ts', rules)).toBe(false);
    expect(isIgnoredFile('README.md', rules)).toBe(false);
  });

  it('returns false for empty path inputs', () => {
    expect(isIgnoredDir('', rules)).toBe(false);
    expect(isIgnoredFile('', rules)).toBe(false);
  });
});

describe('.gitignore globs', () => {
  it('honours simple wildcards', async () => {
    rules = await loadWith('*.log\n');
    expect(isIgnoredFile('app.log', rules)).toBe(true);
    expect(isIgnoredFile('logs/app.log', rules)).toBe(true);
    expect(isIgnoredFile('app.txt', rules)).toBe(false);
  });

  it('honours ** globs', async () => {
    rules = await loadWith('**/generated/**\n');
    expect(isIgnoredFile('a/generated/x.ts', rules)).toBe(true);
    expect(isIgnoredFile('deeply/nested/generated/z.ts', rules)).toBe(true);
    expect(isIgnoredFile('a/normal/x.ts', rules)).toBe(false);
  });

  it('honours ! negations', async () => {
    rules = await loadWith('*.log\n!keep.log\n');
    expect(isIgnoredFile('noisy.log', rules)).toBe(true);
    expect(isIgnoredFile('keep.log', rules)).toBe(false);
  });

  it('honours leading-slash anchored patterns', async () => {
    rules = await loadWith('/config\n');
    expect(isIgnoredDir('config', rules)).toBe(true);
    expect(isIgnoredDir('a/config', rules)).toBe(false);
  });

  it('treats directory patterns as dir-only', async () => {
    rules = await loadWith('build/\n');
    expect(isIgnoredDir('build', rules)).toBe(true);
    // A file literally named "build" without trailing slash on a real fs would
    // not match a `build/` pattern — verify the matcher distinguishes.
    expect(isIgnoredFile('build', rules)).toBe(false);
  });
});
