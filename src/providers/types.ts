import type { LanguageModel } from 'ai';
import type { ProviderId } from '../config.js';

export interface ResolvedProvider {
  id: ProviderId;
  model: LanguageModel;
  modelId: string;
  label: string;
  baseURL: string;
}

export type ProviderFactory = (input: {
  env: NodeJS.ProcessEnv;
  fetchImpl: typeof fetch;
}) => Promise<ResolvedProvider> | ResolvedProvider;
