import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const homeRef = { value: '' };
const platformRef = { value: process.platform as string };
const oldAppData = process.env.APPDATA;

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return {
    ...actual,
    homedir: () => homeRef.value,
    platform: () => platformRef.value,
  };
});

beforeAll(() => {
  process.env.APPDATA = '';
});

afterAll(() => {
  if (oldAppData === undefined) delete process.env.APPDATA;
  else process.env.APPDATA = oldAppData;
});

const {
  DEFAULT_CONFIG,
  clearConfigCache,
  getConfigPath,
  loadConfig,
  saveConfig,
} = await import('../src/config.js');

let scratch: string;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'bonfire-config-'));
  homeRef.value = scratch;
  platformRef.value = process.platform;
  clearConfigCache();
});

afterEach(async () => {
  clearConfigCache();
  await rm(scratch, { recursive: true, force: true });
});

describe('getConfigPath', () => {
  it('points to ~/.config/bonfire/config.json on linux/macOS', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    expect(getConfigPath()).toBe(join(scratch, '.config', 'bonfire', 'config.json'));
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    expect(getConfigPath()).toBe(join(scratch, '.config', 'bonfire', 'config.json'));
  });

  it('uses APPDATA on Windows when set', () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    const oldAppData = process.env.APPDATA;
    process.env.APPDATA = join(scratch, 'AppData', 'Roaming');
    expect(getConfigPath()).toBe(
      join(scratch, 'AppData', 'Roaming', 'bonfire', 'config.json'),
    );
    if (oldAppData === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = oldAppData;
    Object.defineProperty(process, 'platform', { value: process.platform, configurable: true });
  });

  it('falls back to ~/AppData/Roaming on Windows when APPDATA is unset', () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    const oldAppData = process.env.APPDATA;
    delete process.env.APPDATA;
    expect(getConfigPath()).toBe(
      join(scratch, 'AppData', 'Roaming', 'bonfire', 'config.json'),
    );
    if (oldAppData !== undefined) process.env.APPDATA = oldAppData;
    Object.defineProperty(process, 'platform', { value: process.platform, configurable: true });
  });
});

describe('loadConfig + mergeConfig', () => {
  async function plant(content: object): Promise<void> {
    const path = getConfigPath();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(content), 'utf-8');
  }

  it('returns DEFAULT_CONFIG when no file exists', async () => {
    const cfg = await loadConfig(scratch);
    expect(cfg.provider?.active).toBe(DEFAULT_CONFIG.provider?.active);
    expect(cfg.provider?.ollama?.baseURL).toBe(
      DEFAULT_CONFIG.provider?.ollama?.baseURL,
    );
  });

  it('merges user provider on top of defaults preserving sibling fields', async () => {
    await plant({
      provider: {
        active: 'remote',
        ollama: { model: 'overridden:latest' },
      },
    });
    const cfg = await loadConfig(scratch);
    expect(cfg.provider?.active).toBe('remote');
    // Default baseURL preserved when user only overrode model.
    expect(cfg.provider?.ollama?.baseURL).toBe(
      DEFAULT_CONFIG.provider?.ollama?.baseURL,
    );
    expect(cfg.provider?.ollama?.model).toBe('overridden:latest');
    // Default llama.cpp block untouched.
    expect(cfg.provider?.['llama.cpp']?.baseURL).toBe(
      DEFAULT_CONFIG.provider?.['llama.cpp']?.baseURL,
    );
  });

  it('merges security.shell with defaults', async () => {
    await plant({
      security: { shell: { allowedCommands: ['^git status$'] } },
    });
    const cfg = await loadConfig(scratch);
    expect(cfg.security?.shell?.allowedCommands).toEqual(['^git status$']);
    expect(cfg.security?.shell?.requireApproval).toBe(true); // default kept
  });

  it('preserves user systemPrompt verbatim', async () => {
    await plant({ systemPrompt: 'haiku only', systemPromptMode: 'replace' });
    const cfg = await loadConfig(scratch);
    expect(cfg.systemPrompt).toBe('haiku only');
    expect(cfg.systemPromptMode).toBe('replace');
  });

  it('handles a mcpServers map', async () => {
    await plant({
      mcpServers: {
        fs: { command: 'npx', args: ['-y', 'something'] },
      },
    });
    const cfg = await loadConfig(scratch);
    expect(cfg.mcpServers?.fs).toEqual({
      command: 'npx',
      args: ['-y', 'something'],
    });
  });

  it('returns the cached config on subsequent calls', async () => {
    await plant({ systemPrompt: 'first' });
    const a = await loadConfig(scratch);
    expect(a.systemPrompt).toBe('first');
    // Mutate the file under us; without invalidation, the cached parse persists.
    await plant({ systemPrompt: 'second' });
    const b = await loadConfig(scratch);
    expect(b.systemPrompt).toBe('first');
    clearConfigCache();
    const c = await loadConfig(scratch);
    expect(c.systemPrompt).toBe('second');
  });

  it('saveConfig persists to disk and busts the cache', async () => {
    await saveConfig({ systemPrompt: 'persisted' });
    const cfg = await loadConfig(scratch);
    expect(cfg.systemPrompt).toBe('persisted');
  });

  it('preserves unknown top-level keys instead of dropping them', async () => {
    // Regression: the old hand-rolled merge enumerated known keys only, so
    // codemap.concurrency never reached summarizeCodemap.
    await plant({ codemap: { concurrency: 12 } });
    const cfg = await loadConfig(scratch);
    expect(cfg.codemap?.concurrency).toBe(12);
  });

  it('deep-merges nested sections not special-cased by the old merge', async () => {
    await plant({ context: { maxTokens: 32768 } });
    const cfg = await loadConfig(scratch);
    expect(cfg.context?.maxTokens).toBe(32768);
    // Siblings survive.
    expect(cfg.context?.compactThreshold).toBe(
      DEFAULT_CONFIG.context?.compactThreshold,
    );
    expect(cfg.context?.autoCompact).toBe(true);
  });

  it('deep-merges provider.remote like the other providers', async () => {
    await plant({ provider: { remote: { model: 'gpt-4o' } } });
    const cfg = await loadConfig(scratch);
    expect(cfg.provider?.remote?.model).toBe('gpt-4o');
    expect(cfg.provider?.remote?.baseURL).toBe('');
  });

  it('replaces arrays wholesale rather than concatenating', async () => {
    await plant({ security: { shell: { deniedCommands: ['^curl'] } } });
    const cfg = await loadConfig(scratch);
    expect(cfg.security?.shell?.deniedCommands).toEqual(['^curl']);
  });

  it('layers the project config over the global one', async () => {
    await plant({
      provider: { active: 'ollama', ollama: { model: 'global-model' } },
      systemPrompt: 'from global',
    });
    await writeFile(
      join(scratch, 'bonfire.config.json'),
      JSON.stringify({ provider: { ollama: { model: 'project-model' } } }),
      'utf-8',
    );
    const cfg = await loadConfig(scratch);
    expect(cfg.provider?.ollama?.model).toBe('project-model');
    // Global-only keys still apply.
    expect(cfg.systemPrompt).toBe('from global');
    // Defaults below both layers survive.
    expect(cfg.provider?.ollama?.baseURL).toBe(
      DEFAULT_CONFIG.provider?.ollama?.baseURL,
    );
  });

  it('ignores an unparseable project config instead of throwing', async () => {
    await plant({ systemPrompt: 'global wins' });
    await writeFile(join(scratch, 'bonfire.config.json'), '{ not json', 'utf-8');
    const cfg = await loadConfig(scratch);
    expect(cfg.systemPrompt).toBe('global wins');
  });
});
