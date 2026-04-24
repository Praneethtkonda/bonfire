import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface OllamaProviderConfig {
  baseURL?: string;
  model?: string;
}

export interface LlamaCppProviderConfig {
  baseURL?: string;
  model?: string;
  apiKey?: string;
  headers?: Record<string, string>;
}

export type ProviderId = 'ollama' | 'llama.cpp';

export interface ProviderConfig {
  active?: ProviderId;
  ollama?: OllamaProviderConfig;
  'llama.cpp'?: LlamaCppProviderConfig;
}

export interface NanoConfig {
  provider?: ProviderConfig;
  mcpServers?: Record<string, McpServerConfig>;
}

const CONFIG_FILENAME = 'nano-code.config.json';

let cached: NanoConfig | null = null;

export async function loadConfig(): Promise<NanoConfig> {
  if (cached) return cached;
  const path = resolve(process.cwd(), CONFIG_FILENAME);
  try {
    const raw = await readFile(path, 'utf-8');
    cached = JSON.parse(raw) as NanoConfig;
  } catch {
    cached = {};
  }
  return cached;
}
