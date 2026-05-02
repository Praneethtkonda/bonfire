import { loadConfig, type ProviderId } from '../config.js';
import { createLlamaCppProvider } from './llamacpp.js';
import { createOllamaProvider } from './ollama.js';
import { createRemoteProvider } from './remote.js';
import type { ResolvedProvider } from './types.js';

export type { ResolvedProvider } from './types.js';

const FACTORIES: Record<ProviderId, typeof createOllamaProvider> = {
  ollama: createOllamaProvider,
  'llama.cpp': createLlamaCppProvider,
  remote: createRemoteProvider,
};

function isProviderId(value: string | undefined): value is ProviderId {
  return value === 'ollama' || value === 'llama.cpp' || value === 'remote';
}

export async function resolveProvider(input: {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
} = {}): Promise<ResolvedProvider> {
  const env = input.env ?? process.env;
  const fetchImpl = input.fetchImpl ?? fetch;
  const cfg = await loadConfig();

  const envProvider = env.BONFIRE_PROVIDER;
  const configProvider = cfg.provider?.active;
  const selected: ProviderId = isProviderId(envProvider)
    ? envProvider
    : isProviderId(configProvider)
      ? configProvider
      : 'ollama';

  const factory = FACTORIES[selected];
  return factory({ env, fetchImpl });
}
