import { createOllama } from 'ollama-ai-provider-v2';
import { loadConfig, expandEnv } from '../config.js';
import type { ResolvedProvider } from './types.js';

const DEFAULT_BASE_URL = 'http://127.0.0.1:11434/api';
const DEFAULT_MODEL = 'qwen3.6:latest';

function expand(value: string | undefined, env: NodeJS.ProcessEnv): string | undefined {
  return value === undefined ? undefined : expandEnv(value, env);
}

export async function createOllamaProvider(input: {
  env: NodeJS.ProcessEnv;
  fetchImpl: typeof fetch;
}): Promise<ResolvedProvider> {
  const cfg = (await loadConfig()).provider?.ollama ?? {};
  const env = input.env;
  const baseURL = env.OLLAMA_BASE_URL ?? expand(cfg.baseURL, env) ?? DEFAULT_BASE_URL;
  const modelId = expand(cfg.model, env) ?? env.BONFIRE_MODEL ?? DEFAULT_MODEL;

  const sdk = createOllama({ baseURL, fetch: input.fetchImpl });

  return {
    id: 'ollama',
    model: sdk(modelId),
    modelId,
    baseURL,
    label: `ollama · ${modelId}`,
  };
}
