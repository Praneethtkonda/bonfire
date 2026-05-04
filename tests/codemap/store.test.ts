import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  cachePath,
  invalidateCodemapCache,
  loadCodemap,
  saveCodemap,
} from '../../src/codemap/store.js';
import type { Codemap } from '../../src/codemap/types.js';

let scratch: string;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'bonfire-store-'));
  invalidateCodemapCache();
});

afterEach(async () => {
  invalidateCodemapCache();
  await rm(scratch, { recursive: true, force: true });
});

function fixture(): Codemap {
  return {
    version: 1,
    root: scratch,
    builtAt: 1,
    summarizedAt: 0,
    tree: { path: '', name: '.', kind: 'dir', skeleton: 'empty', children: [] },
  };
}

describe('store memoization', () => {
  it('returns the same parsed object on repeat reads when the file is unchanged', async () => {
    await saveCodemap(scratch, fixture());
    const a = await loadCodemap(scratch);
    const b = await loadCodemap(scratch);
    expect(a).not.toBeNull();
    expect(a).toBe(b); // referential equality — cache hit
  });

  it('refreshes when the on-disk mtime changes', async () => {
    await saveCodemap(scratch, fixture());
    const first = await loadCodemap(scratch);
    expect(first).not.toBeNull();

    // Wait so writeFile produces a strictly newer mtime even on filesystems
    // with second-resolution timestamps.
    await new Promise((r) => setTimeout(r, 20));
    const updated = fixture();
    updated.builtAt = 999;
    await writeFile(cachePath(scratch), JSON.stringify(updated), 'utf-8');

    const second = await loadCodemap(scratch);
    expect(second?.builtAt).toBe(999);
  });

  it('returns null and forgets the cache when the file is missing', async () => {
    expect(await loadCodemap(scratch)).toBeNull();
  });

  it('invalidateCodemapCache(root) drops the cached object so the next read parses fresh', async () => {
    await saveCodemap(scratch, fixture());
    const first = await loadCodemap(scratch);
    invalidateCodemapCache(scratch);
    const second = await loadCodemap(scratch);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(second).not.toBe(first); // fresh parse produced a new object reference
    expect(second).toEqual(first); // but the data is identical
  });
});
