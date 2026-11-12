import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  forgetMemory,
  listMemory,
  memoryBlock,
  memoryDir,
  readMemory,
  saveMemory,
} from '../../src/memory/index.js';

let cwd: string;
let home: string;
const realHome = process.env.HOME;
const realAppData = process.env.APPDATA;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'bonfire-mem-repo-'));
  home = mkdtempSync(join(tmpdir(), 'bonfire-mem-home-'));
  process.env.HOME = home;
  // On Windows the config dir comes from %APPDATA%, not HOME.
  process.env.APPDATA = home;
});

afterEach(() => {
  process.env.HOME = realHome;
  if (realAppData === undefined) delete process.env.APPDATA;
  else process.env.APPDATA = realAppData;
  rmSync(cwd, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

describe('memory', () => {
  it('saves notes per scope, skips duplicates and shows the indexes in the prompt', async () => {
    expect((await saveMemory({ scope: 'repo', note: 'Run tests with `npm test`' }, cwd)).ok).toBe(true);
    expect((await saveMemory({ scope: 'repo', note: 'run tests with `npm test` ' }, cwd)).duplicate).toBe(true);
    await saveMemory({ scope: 'user', note: 'Prefers British spelling' }, cwd);

    expect(memoryDir('repo', cwd)).toBe(join(cwd, '.bonfire', 'memory'));
    const block = await memoryBlock(cwd);
    expect(block).toContain('- Run tests with `npm test`');
    expect(block).toContain('- Prefers British spelling');
    expect(block.match(/npm test/gi)).toHaveLength(1);
  });

  it('files topic notes separately and links them from the index', async () => {
    await saveMemory({ scope: 'repo', note: 'Integration tests need Docker', topic: 'Testing' }, cwd);
    await saveMemory({ scope: 'repo', note: 'Use vitest, not jest', topic: 'testing' }, cwd);
    const topic = await readMemory({ scope: 'repo', topic: 'testing' }, cwd);
    expect(topic.text).toContain('- Integration tests need Docker');
    expect(topic.text).toContain('- Use vitest, not jest');
    const index = readFileSync(join(memoryDir('repo', cwd), 'MEMORY.md'), 'utf-8');
    expect(index.match(/\(testing\.md\)/g)).toHaveLength(1);
    expect(await memoryBlock(cwd)).toContain('- Use vitest, not jest');
    expect((await listMemory(cwd)).map((f) => `${f.scope}:${f.name}:${f.notes}`)).toEqual([
      'repo:MEMORY.md:1',
      'repo:testing.md:2',
    ]);
  });

  it('refuses secrets and forgets matching notes', async () => {
    const r = await saveMemory({ scope: 'repo', note: 'deploy token: ghp_abcdefghijklmnopqrstuvwxyz0123456789' }, cwd);
    expect(r.ok).toBe(false);
    await saveMemory({ scope: 'repo', note: 'The API lives in services/api' }, cwd);
    await saveMemory({ scope: 'repo', note: 'Old: the API lives in api/' }, cwd);
    expect((await forgetMemory({ scope: 'repo', match: 'old:' }, cwd)).removed).toBe(1);
    const { text } = await readMemory({ scope: 'repo' }, cwd);
    expect(text).toContain('services/api');
    expect(text).not.toContain('Old:');
  });

  it('caps a long index', async () => {
    for (let i = 0; i < 210; i++) await saveMemory({ scope: 'repo', note: `fact ${i}` }, cwd);
    const block = await memoryBlock(cwd);
    expect(block).toContain('[index truncated');
    expect(block).not.toContain('fact 209');
  });
});
