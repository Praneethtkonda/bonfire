import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export interface StdioMcpServerConfig {
  type?: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface StreamableHttpMcpServerConfig {
  type: 'streamable-http';
  url: string;
  headers?: Record<string, string>;
}

export type McpServerConfig = StdioMcpServerConfig | StreamableHttpMcpServerConfig;

export function isStreamableHttpMcp(
  cfg: McpServerConfig,
): cfg is StreamableHttpMcpServerConfig {
  return cfg.type === 'streamable-http';
}

/**
 * Expand ${ENV_VAR} references in a string using process.env.
 * Missing vars are left as-is so misconfigurations are visible in logs.
 */
export function expandEnv(value: string, env: NodeJS.ProcessEnv = process.env): string {
  return value.replace(/\$\{([A-Z0-9_]+)\}/gi, (_m, key) => env[key] ?? `\${${key}}`);
}

export function expandEnvMap(
  map: Record<string, string> | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> | undefined {
  if (!map) return map;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(map)) out[k] = expandEnv(v, env);
  return out;
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

export interface ShellSecurityConfig {
  /** Regex patterns of commands that skip the approval prompt. */
  allowedCommands?: string[];
  /** Regex patterns refused even after approval (in addition to built-in deny list). */
  deniedCommands?: string[];
  /** Set true to require approval for every shell call (default: true). */
  requireApproval?: boolean;
}

export interface SecurityConfig {
  shell?: ShellSecurityConfig;
  /** Require approval before MCP tool calls (default: false). */
  mcpRequireApproval?: boolean;
}

export interface NanoConfig {
  provider?: ProviderConfig;
  mcpServers?: Record<string, McpServerConfig>;
  /** Inline override appended to (or replacing) the built-in system prompt. */
  systemPrompt?: string;
  /** 'append' (default) keeps the built-in prompt; 'replace' substitutes it entirely. */
  systemPromptMode?: 'append' | 'replace';
  security?: SecurityConfig;
}

const CONFIG_FILENAME = 'bonfire.config.json';

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
