import { createOllama } from 'ollama-ai-provider-v2';
import { loadConfig } from '../config.js';
import type { ResolvedProvider } from './types.js';

const DEFAULT_BASE_URL = 'http://localhost:11434/api';
const DEFAULT_MODEL = 'qwen2.5-coder:latest';

export async function createOllamaProvider(input: {
  env: NodeJS.ProcessEnv;
  fetchImpl: typeof fetch;
}): Promise<ResolvedProvider> {
  const cfg = (await loadConfig()).provider?.ollama ?? {};
  const baseURL = input.env.OLLAMA_BASE_URL ?? cfg.baseURL ?? DEFAULT_BASE_URL;
  const modelId = input.env.BONFIRE_MODEL ?? cfg.model ?? DEFAULT_MODEL;

  const sdk = createOllama({ baseURL, fetch: input.fetchImpl });

  return {
    id: 'ollama',
    model: sdk(modelId),
    modelId,
    baseURL,
    label: `ollama · ${modelId}`,
  };
}
