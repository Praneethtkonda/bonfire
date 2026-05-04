import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const homeRef = { value: '' };
const platformRef = { value: process.platform as string };

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return {
    ...actual,
    homedir: () => homeRef.value,
    platform: () => platformRef.value,
  };
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
    const cfg = await loadConfig();
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
    const cfg = await loadConfig();
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
    const cfg = await loadConfig();
    expect(cfg.security?.shell?.allowedCommands).toEqual(['^git status$']);
    expect(cfg.security?.shell?.requireApproval).toBe(true); // default kept
  });

  it('preserves user systemPrompt verbatim', async () => {
    await plant({ systemPrompt: 'haiku only', systemPromptMode: 'replace' });
    const cfg = await loadConfig();
    expect(cfg.systemPrompt).toBe('haiku only');
    expect(cfg.systemPromptMode).toBe('replace');
  });

  it('handles a mcpServers map', async () => {
    await plant({
      mcpServers: {
        fs: { command: 'npx', args: ['-y', 'something'] },
      },
    });
    const cfg = await loadConfig();
    expect(cfg.mcpServers?.fs).toEqual({
      command: 'npx',
      args: ['-y', 'something'],
    });
  });

  it('returns the cached config on subsequent calls', async () => {
    await plant({ systemPrompt: 'first' });
    const a = await loadConfig();
    expect(a.systemPrompt).toBe('first');
    // Mutate the file under us; without invalidation, the cached parse persists.
    await plant({ systemPrompt: 'second' });
    const b = await loadConfig();
    expect(b.systemPrompt).toBe('first');
    clearConfigCache();
    const c = await loadConfig();
    expect(c.systemPrompt).toBe('second');
  });

  it('saveConfig persists to disk and busts the cache', async () => {
    await saveConfig({ systemPrompt: 'persisted' });
    const cfg = await loadConfig();
    expect(cfg.systemPrompt).toBe('persisted');
  });
});
