import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { loadConfig, expandEnv, expandEnvMap } from '../config.js';
import type { ResolvedProvider } from './types.js';

// llama.cpp's `llama-server` exposes an OpenAI-compatible API at /v1.
// This mirrors opencode's pattern: register llama.cpp as a custom provider
// backed by @ai-sdk/openai-compatible and point baseURL at the local server.
// https://github.com/ggml-org/llama.cpp
const DEFAULT_BASE_URL = 'http://127.0.0.1:8080/v1';
const DEFAULT_MODEL = 'qwen3.6:latest';

function expand(value: string | undefined, env: NodeJS.ProcessEnv): string | undefined {
  return value === undefined ? undefined : expandEnv(value, env);
}

export async function createLlamaCppProvider(input: {
  env: NodeJS.ProcessEnv;
  fetchImpl: typeof fetch;
}): Promise<ResolvedProvider> {
  const cfg = (await loadConfig()).provider?.['llama.cpp'] ?? {};
  const env = input.env;

  const baseURL = env.LLAMACPP_BASE_URL ?? expand(cfg.baseURL, env) ?? DEFAULT_BASE_URL;
  const modelId = expand(cfg.model, env) ?? env.BONFIRE_MODEL ?? DEFAULT_MODEL;
  const apiKey = env.LLAMACPP_API_KEY ?? expand(cfg.apiKey, env);

  const sdk = createOpenAICompatible({
    name: 'llama.cpp',
    baseURL,
    apiKey,
    headers: expandEnvMap(cfg.headers, env),
    fetch: input.fetchImpl,
    includeUsage: true,
  });

  return {
    id: 'llama.cpp',
    model: sdk.chatModel(modelId),
    modelId,
    baseURL,
    label: `llama.cpp · ${modelId}`,
  };
}
