import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { loadConfig, expandEnv, expandEnvMap, type RemoteProviderConfig } from '../config.js';
import type { ResolvedProvider } from './types.js';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';

function expand(value: string | undefined, env: NodeJS.ProcessEnv): string | undefined {
  return value === undefined ? undefined : expandEnv(value, env);
}

export async function createRemoteProvider(input: {
  env: NodeJS.ProcessEnv;
  fetchImpl: typeof fetch;
}): Promise<ResolvedProvider> {
  const cfg = (await loadConfig()).provider?.remote ?? ({} as RemoteProviderConfig);
  const env = input.env;

  const baseURL = expand(cfg.baseURL, env) || env.REMOTE_BASE_URL || DEFAULT_BASE_URL;
  const modelId = expand(cfg.model, env) || env.BONFIRE_MODEL || DEFAULT_MODEL;
  const apiKey = env.REMOTE_API_KEY ?? expand(cfg.apiKey, env);

  const headers = expandEnvMap(cfg.headers, env) ?? {};

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
