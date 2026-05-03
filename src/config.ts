import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { homedir } from 'node:os';

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

export const DEFAULT_CONFIG: NanoConfig = {
  provider: {
    active: 'ollama',
    ollama: {
      baseURL: 'http://127.0.0.1:11434/api',
      model: 'qwen3.6:latest',
    },
    'llama.cpp': {
      baseURL: 'http://127.0.0.1:8080/v1',
      model: 'unsloth/Qwen3.6-35B-A3B',
    },
    remote: {
      baseURL: '',
      model: '',
    },
  },
  mcpServers: {},
  security: {
    shell: {
      requireApproval: true,
    },
    mcpRequireApproval: false,
  },
};

export function getConfigPath(): string {
  const home = homedir();
  const isWindows = process.platform === 'win32';
  const baseDir = isWindows
    ? process.env.APPDATA || resolve(home, 'AppData', 'Roaming')
    : resolve(home, '.config');
  return resolve(baseDir, 'bonfire', 'config.json');
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

export interface RemoteProviderConfig {
  baseURL: string;
  model: string;
  apiKey?: string;
  headers?: Record<string, string>;
}

export type ProviderId = 'ollama' | 'llama.cpp' | 'remote';

export interface ProviderConfig {
  active?: ProviderId;
  ollama?: OllamaProviderConfig;
  'llama.cpp'?: LlamaCppProviderConfig;
  remote?: RemoteProviderConfig;
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

let cached: NanoConfig | null = null;

export async function loadConfig(): Promise<NanoConfig> {
  if (cached) return cached;
  const path = getConfigPath();
  try {
    const raw = await readFile(path, 'utf-8');
    const userConfig = JSON.parse(raw) as NanoConfig;
    cached = mergeConfig(DEFAULT_CONFIG, userConfig);
  } catch {
    cached = DEFAULT_CONFIG;
  }
  return cached;
}

function mergeConfig(defaults: NanoConfig, user: Partial<NanoConfig>): NanoConfig {
  const result: NanoConfig = { ...defaults };
  
  if (user.provider) {
    result.provider = { ...defaults.provider, ...user.provider };
    if (user.provider.ollama && defaults.provider?.ollama) {
      result.provider.ollama = { ...defaults.provider.ollama, ...user.provider.ollama };
    }
    if (user.provider['llama.cpp'] && defaults.provider?.['llama.cpp']) {
      result.provider['llama.cpp'] = { ...defaults.provider['llama.cpp'], ...user.provider['llama.cpp'] };
    }
  }
  
  if (user.mcpServers) {
    result.mcpServers = { ...defaults.mcpServers, ...user.mcpServers };
  }
  
  if (user.security) {
    result.security = { ...defaults.security, ...user.security };
    if (user.security.shell && defaults.security?.shell) {
      result.security.shell = { ...defaults.security.shell, ...user.security.shell };
    }
  }
  
  if (user.systemPrompt !== undefined) {
    result.systemPrompt = user.systemPrompt;
  }
  if (user.systemPromptMode) {
    result.systemPromptMode = user.systemPromptMode;
  }
  
  return result;
}

export async function saveConfig(config: NanoConfig): Promise<void> {
  const path = getConfigPath();
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  await writeFile(path, JSON.stringify(config, null, 2) + '\n');
  cached = null;
}

export function clearConfigCache(): void {
  cached = null;
}

export interface ValidationError {
  field: string;
  message: string;
}

export function validateConfig(config: NanoConfig): ValidationError[] {
  const errors: ValidationError[] = [];

  if (config.provider) {
    const active = config.provider.active;
    if (active && !['ollama', 'llama.cpp', 'remote'].includes(active)) {
      errors.push({ field: 'provider.active', message: `Invalid provider: ${active}. Must be 'ollama', 'llama.cpp', or 'remote'` });
    }

    if (config.provider.ollama) {
      const ollama = config.provider.ollama;
      if (ollama.baseURL && !isValidUrl(ollama.baseURL)) {
        errors.push({ field: 'provider.ollama.baseURL', message: 'Invalid URL format' });
      }
      if (ollama.model && typeof ollama.model !== 'string') {
        errors.push({ field: 'provider.ollama.model', message: 'Model must be a string' });
      }
    }

    if (config.provider['llama.cpp']) {
      const llama = config.provider['llama.cpp'];
      if (llama.baseURL && !isValidUrl(llama.baseURL)) {
        errors.push({ field: 'provider.llama.cpp.baseURL', message: 'Invalid URL format' });
      }
      if (llama.model && typeof llama.model !== 'string') {
        errors.push({ field: 'provider.llama.cpp.model', message: 'Model must be a string' });
      }
    }

    if (config.provider.remote) {
      const remote = config.provider.remote;
      if (remote.baseURL && !isValidUrl(remote.baseURL)) {
        errors.push({ field: 'provider.remote.baseURL', message: 'Invalid URL format' });
      }
      if (remote.model && typeof remote.model !== 'string') {
        errors.push({ field: 'provider.remote.model', message: 'Model must be a string' });
      }
      if (remote.apiKey && typeof remote.apiKey !== 'string') {
        errors.push({ field: 'provider.remote.apiKey', message: 'API key must be a string' });
      }
    }
  }

  if (config.mcpServers) {
    for (const [name, server] of Object.entries(config.mcpServers)) {
      if ('command' in server) {
        if (!server.command || typeof server.command !== 'string') {
          errors.push({ field: `mcpServers.${name}.command`, message: 'Command is required' });
        }
      } else if ('url' in server) {
        if (!server.url || !isValidUrl(server.url)) {
          errors.push({ field: `mcpServers.${name}.url`, message: 'Valid URL is required' });
        }
      }
    }
  }

  if (config.security?.shell?.allowedCommands) {
    if (!Array.isArray(config.security.shell.allowedCommands)) {
      errors.push({ field: 'security.shell.allowedCommands', message: 'Must be an array' });
    }
  }

  if (config.security?.shell?.deniedCommands) {
    if (!Array.isArray(config.security.shell.deniedCommands)) {
      errors.push({ field: 'security.shell.deniedCommands', message: 'Must be an array' });
    }
  }

  return errors;
}

function isValidUrl(str: string): boolean {
  try {
    new URL(str);
    return true;
  } catch {
    return false;
  }
}
