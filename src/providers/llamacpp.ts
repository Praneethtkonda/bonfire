import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { loadConfig } from '../config.js';
import type { ResolvedProvider } from './types.js';

// llama.cpp's `llama-server` exposes an OpenAI-compatible API at /v1.
// This mirrors opencode's pattern: register llama.cpp as a custom provider
// backed by @ai-sdk/openai-compatible and point baseURL at the local server.
// https://github.com/ggml-org/llama.cpp
const DEFAULT_BASE_URL = 'http://127.0.0.1:8080/v1';
const DEFAULT_MODEL = 'local-model';

export async function createLlamaCppProvider(input: {
  env: NodeJS.ProcessEnv;
  fetchImpl: typeof fetch;
}): Promise<ResolvedProvider> {
  const cfg = (await loadConfig()).provider?.['llama.cpp'] ?? {};
  const baseURL = input.env.LLAMACPP_BASE_URL ?? cfg.baseURL ?? DEFAULT_BASE_URL;
  const modelId = input.env.NANO_MODEL ?? cfg.model ?? DEFAULT_MODEL;
  const apiKey = input.env.LLAMACPP_API_KEY ?? cfg.apiKey;

  const sdk = createOpenAICompatible({
    name: 'llama.cpp',
    baseURL,
    apiKey,
    headers: cfg.headers,
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
