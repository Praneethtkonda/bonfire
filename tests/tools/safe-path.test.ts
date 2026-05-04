import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { addAllowedDir, safePath } from '../../src/tools/safe-path.js';

let scratch: string;
let allowed: string;
let outside: string;

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'bonfire-safe-path-'));
  allowed = join(scratch, 'allowed');
  outside = join(scratch, 'outside');
  await mkdir(allowed, { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(join(allowed, 'note.txt'), 'hello');
  await writeFile(join(outside, 'secret.txt'), 'no peeking');
  await addAllowedDir(allowed);
});

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe('safePath - lexical guard', () => {
  it('accepts a path inside the allowed dir', async () => {
    const abs = await safePath(join(allowed, 'note.txt'));
    expect(abs).toBe(resolve(allowed, 'note.txt'));
  });

  it('accepts the allowed dir itself', async () => {
    const abs = await safePath(allowed);
    expect(abs).toBe(resolve(allowed));
  });

  it('rejects ../ traversal that escapes every allowed dir', async () => {
    await expect(safePath(join(allowed, '..', 'outside', 'secret.txt'))).rejects.toThrow(
      /not in any allowed directory/,
    );
  });

  it('rejects a sibling absolute path that is outside any allowed dir', async () => {
    await expect(safePath(join(outside, 'secret.txt'))).rejects.toThrow(
      /not in any allowed directory/,
    );
  });
});

describe('safePath - non-existent files', () => {
  it('allows a path under an allowed dir even if the file does not exist yet (write_file case)', async () => {
    const abs = await safePath(join(allowed, 'will-be-created.txt'));
    expect(abs).toBe(resolve(allowed, 'will-be-created.txt'));
  });

  it('allows a nested non-existent path under an allowed dir', async () => {
    const abs = await safePath(join(allowed, 'new-dir', 'nested.txt'));
    expect(abs).toBe(resolve(allowed, 'new-dir', 'nested.txt'));
  });
});

describe('safePath - symlink escape', () => {
  it('rejects a symlink inside an allowed dir that points outside', async () => {
    const linkPath = join(allowed, 'escape-link');
    try {
      await symlink(outside, linkPath);
    } catch {
      // On systems without symlink support, skip the test gracefully.
      return;
    }
    await expect(safePath(join(linkPath, 'secret.txt'))).rejects.toThrow(
      /resolves outside the allowlist via symlink/,
    );
  });
});
