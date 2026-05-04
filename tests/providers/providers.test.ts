import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockedConfig: { provider?: any } = {};
vi.mock('../../src/config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/config.js')>();
  return {
    ...actual,
    loadConfig: async () => mockedConfig,
  };
});

vi.mock('ollama-ai-provider-v2', () => ({
  createOllama: (opts: any) => {
    lastOllamaOpts = opts;
    return (modelId: string) => ({ __mock: 'ollama', modelId });
  },
}));

vi.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: (opts: any) => {
    lastCompatOpts = opts;
    return {
      chatModel: (modelId: string) => ({ __mock: 'openai-compat', modelId, opts }),
    };
  },
}));

let lastOllamaOpts: any;
let lastCompatOpts: any;

const { createOllamaProvider } = await import('../../src/providers/ollama.js');
const { createLlamaCppProvider } = await import('../../src/providers/llamacpp.js');
const { createRemoteProvider } = await import('../../src/providers/remote.js');

beforeEach(() => {
  delete mockedConfig.provider;
  lastOllamaOpts = undefined;
  lastCompatOpts = undefined;
});

afterEach(() => {
  vi.unstubAllEnvs?.();
});

describe('createOllamaProvider', () => {
  it('uses defaults when no env or config provided', async () => {
    const p = await createOllamaProvider({ env: {}, fetchImpl: fetch });
    expect(p.id).toBe('ollama');
    expect(p.baseURL).toBe('http://127.0.0.1:11434/api');
    expect(p.modelId).toBe('qwen3.6:latest');
    expect(p.label).toContain('ollama · qwen3.6:latest');
  });

  it('OLLAMA_BASE_URL env wins over config', async () => {
    mockedConfig.provider = { ollama: { baseURL: 'http://config-url/api' } };
    const p = await createOllamaProvider({
      env: { OLLAMA_BASE_URL: 'http://env-url/api' },
      fetchImpl: fetch,
    });
    expect(p.baseURL).toBe('http://env-url/api');
  });

  it('expands ${ENV} references in config baseURL and model', async () => {
    mockedConfig.provider = {
      ollama: { baseURL: 'http://${HOST}/api', model: 'mod-${TAG}' },
    };
    const p = await createOllamaProvider({
      env: { HOST: 'box.local:11434', TAG: 'v2' },
      fetchImpl: fetch,
    });
    expect(p.baseURL).toBe('http://box.local:11434/api');
    expect(p.modelId).toBe('mod-v2');
  });
});

describe('createLlamaCppProvider', () => {
  it('uses defaults', async () => {
    const p = await createLlamaCppProvider({ env: {}, fetchImpl: fetch });
    expect(p.baseURL).toBe('http://127.0.0.1:8080/v1');
    expect(p.modelId).toBe('qwen3.6:latest');
    expect(p.label).toContain('llama.cpp');
  });

  it('LLAMACPP_BASE_URL env wins over config', async () => {
    mockedConfig.provider = { 'llama.cpp': { baseURL: 'http://config:8080/v1' } };
    const p = await createLlamaCppProvider({
      env: { LLAMACPP_BASE_URL: 'http://env:8080/v1' },
      fetchImpl: fetch,
    });
    expect(p.baseURL).toBe('http://env:8080/v1');
  });

  it('expands ${ENV} in config fields and headers', async () => {
    mockedConfig.provider = {
      'llama.cpp': {
        baseURL: 'http://${HOST}/v1',
        model: '${MODEL}',
        apiKey: '${KEY}',
        headers: { 'X-Trace': '${TRACE}' },
      },
    };
    await createLlamaCppProvider({
      env: { HOST: 'rig.local:8080', MODEL: 'qwen-large', KEY: 'sk-x', TRACE: 't-1' },
      fetchImpl: fetch,
    });
    expect(lastCompatOpts.baseURL).toBe('http://rig.local:8080/v1');
    expect(lastCompatOpts.apiKey).toBe('sk-x');
    expect(lastCompatOpts.headers).toEqual({ 'X-Trace': 't-1' });
  });

  it('LLAMACPP_API_KEY env overrides config apiKey', async () => {
    mockedConfig.provider = {
      'llama.cpp': { baseURL: 'http://x/v1', apiKey: 'config-key' },
    };
    await createLlamaCppProvider({
      env: { LLAMACPP_API_KEY: 'env-key' },
      fetchImpl: fetch,
    });
    expect(lastCompatOpts.apiKey).toBe('env-key');
  });
});

describe('createRemoteProvider', () => {
  it('uses defaults when nothing set', async () => {
    const p = await createRemoteProvider({ env: {}, fetchImpl: fetch });
    expect(p.baseURL).toBe('https://api.openai.com/v1');
    expect(p.modelId).toBe('gpt-4o-mini');
  });

  it('expands ${ENV} on baseURL, model, apiKey, and headers', async () => {
    mockedConfig.provider = {
      remote: {
        baseURL: '${BASE}/v1',
        model: '${MODEL}',
        apiKey: '${KEY}',
        headers: { Authorization: 'Bearer ${KEY}' },
      },
    };
    const p = await createRemoteProvider({
      env: { BASE: 'https://api.example.com', MODEL: 'turbo', KEY: 'sk-abc' },
      fetchImpl: fetch,
    });
    expect(p.baseURL).toBe('https://api.example.com/v1');
    expect(p.modelId).toBe('turbo');
    expect(lastCompatOpts.apiKey).toBe('sk-abc');
    expect(lastCompatOpts.headers).toEqual({ Authorization: 'Bearer sk-abc' });
  });

  it('REMOTE_API_KEY env wins over config apiKey', async () => {
    mockedConfig.provider = {
      remote: { baseURL: 'https://api.openai.com/v1', model: 'x', apiKey: 'config-key' },
    };
    await createRemoteProvider({
      env: { REMOTE_API_KEY: 'env-key' },
      fetchImpl: fetch,
    });
    expect(lastCompatOpts.apiKey).toBe('env-key');
  });

  it('REMOTE_BASE_URL env used as fallback when config has no baseURL', async () => {
    const p = await createRemoteProvider({
      env: { REMOTE_BASE_URL: 'https://env.example.com/v1' },
      fetchImpl: fetch,
    });
    expect(p.baseURL).toBe('https://env.example.com/v1');
  });
});
