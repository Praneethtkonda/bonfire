import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { loadConfig, expandEnvMap, type RemoteProviderConfig } from '../config.js';
import type { ResolvedProvider } from './types.js';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';

export async function createRemoteProvider(input: {
  env: NodeJS.ProcessEnv;
  fetchImpl: typeof fetch;
}): Promise<ResolvedProvider> {
  const cfg = (await loadConfig()).provider?.remote ?? {} as RemoteProviderConfig;
  const baseURL = expandEnvMap(cfg.baseURL ? { baseURL: cfg.baseURL } : undefined, input.env)?.baseURL 
    ?? input.env.REMOTE_BASE_URL 
    ?? DEFAULT_BASE_URL;
  const modelId = cfg.model ?? input.env.BONFIRE_MODEL ?? DEFAULT_MODEL;
  const apiKey = input.env.REMOTE_API_KEY ?? cfg.apiKey;

  const headers: Record<string, string> = {};
  if (cfg.headers) {
    const expanded = expandEnvMap(cfg.headers, input.env);
    Object.assign(headers, expanded);
  }

  const sdk = createOpenAICompatible({
    name: 'remote',
    baseURL,
    apiKey,
    headers,
    fetch: input.fetchImpl,
    includeUsage: true,
  });

  return {
    id: 'remote',
    model: sdk.chatModel(modelId),
    modelId,
    baseURL,
    label: `remote · ${modelId}`,
  };
}