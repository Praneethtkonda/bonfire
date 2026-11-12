import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { DEFAULT_THEME, isThemeName, themeNames } from './cli/theme.js';

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
    fetch: {
      allowPrivateNetwork: false,
      requireApproval: false,
    },
  },
  codemap: {
    concurrency: 3,
  },
  context: {
    maxTokens: 8192,
    compactThreshold: 0.75,
    autoCompact: true,
    summarize: true,
  },
  ui: {
    theme: DEFAULT_THEME,
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

/** Project-local config file, layered on top of the global one. */
export const PROJECT_CONFIG_FILENAME = 'bonfire.config.json';

export function getProjectConfigPath(cwd: string = process.cwd()): string {
  return resolve(cwd, PROJECT_CONFIG_FILENAME);
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
  /** Timeout for a single shell invocation, in milliseconds (default: 60000). */
  timeoutMs?: number;
}

export interface SecurityConfig {
  shell?: ShellSecurityConfig;
  /** Require approval before MCP tool calls (default: false). */
  mcpRequireApproval?: boolean;
  fetch?: FetchSecurityConfig;
}

export interface FetchSecurityConfig {
  /**
   * Allow fetch_url to reach private / loopback / link-local addresses.
   * Off by default: it blocks SSRF into cloud metadata endpoints and
   * services bound to localhost. (default: false)
   */
  allowPrivateNetwork?: boolean;
  /** Require approval before every fetch_url call (default: false). */
  requireApproval?: boolean;
}

export interface ContextConfig {
  /**
   * Model context window in tokens. Used to budget history and to drive the
   * context meter in the UI. Default: 8192 — the llama.cpp server default,
   * deliberately conservative for local models.
   */
  maxTokens?: number;
  /**
   * Fraction of the window (0–1) at which history is auto-compacted before
   * the next request. Default: 0.75.
   */
  compactThreshold?: number;
  /** Set false to disable automatic compaction entirely. Default: true. */
  autoCompact?: boolean;
  /**
   * Have the model summarise dropped turns during compaction. When false,
   * dropped turns are replaced by the first request only. Default: true.
   */
  summarize?: boolean;
}

export interface UiConfig {
  /** Name of a built-in theme preset. See `/theme` for the list. */
  theme?: string;
}

export interface CodemapConfig {
  /** Max concurrent LLM calls during a /codemap build. Default: 3. */
  concurrency?: number;
}

export interface NanoConfig {
  provider?: ProviderConfig;
  mcpServers?: Record<string, McpServerConfig>;
  /** Inline override appended to (or replacing) the built-in system prompt. */
  systemPrompt?: string;
  /** 'append' (default) keeps the built-in prompt; 'replace' substitutes it entirely. */
  systemPromptMode?: 'append' | 'replace';
  security?: SecurityConfig;
  codemap?: CodemapConfig;
  context?: ContextConfig;
  /** Set false to turn off agentic memory (the memory tool and notes in the prompt). Default: true. */
  memory?: boolean;
  ui?: UiConfig;
}

let cached: NanoConfig | null = null;

async function readJsonIfExists(path: string): Promise<Partial<NanoConfig> | null> {
  try {
    return JSON.parse(await readFile(path, 'utf-8')) as Partial<NanoConfig>;
  } catch {
    return null;
  }
}

/**
 * Layered config, lowest → highest precedence:
 *   1. DEFAULT_CONFIG
 *   2. global config  (~/.config/bonfire/config.json | %APPDATA%\bonfire\config.json)
 *   3. project config (<cwd>/bonfire.config.json)
 *
 * Each layer is deep-merged over the one below it, so a project file that only
 * sets `provider.ollama.model` keeps the global `baseURL`.
 */
export async function loadConfig(cwd: string = process.cwd()): Promise<NanoConfig> {
  if (cached) return cached;
  const global = await readJsonIfExists(getConfigPath());
  const project = await readJsonIfExists(getProjectConfigPath(cwd));
  let merged = DEFAULT_CONFIG;
  if (global) merged = mergeConfig(merged, global);
  if (project) merged = mergeConfig(merged, project);
  cached = merged;
  return cached;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Recursively merge `user` over `defaults`. Plain objects merge key-by-key;
 * arrays and scalars are replaced wholesale. `undefined` on the user side is
 * ignored so an explicitly-absent key never erases a default.
 *
 * Written generically on purpose: the previous hand-rolled version enumerated
 * known keys and silently dropped everything else (`codemap` in particular).
 */
export function mergeConfig(defaults: NanoConfig, user: Partial<NanoConfig>): NanoConfig {
  return deepMerge(
    defaults as Record<string, unknown>,
    user as Record<string, unknown>,
  ) as NanoConfig;
}

function deepMerge(
  defaults: Record<string, unknown>,
  user: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...defaults };
  for (const [key, value] of Object.entries(user)) {
    if (value === undefined) continue;
    const base = out[key];
    out[key] =
      isPlainObject(base) && isPlainObject(value) ? deepMerge(base, value) : value;
  }
  return out;
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

  const concurrency = config.codemap?.concurrency;
  if (concurrency !== undefined) {
    if (typeof concurrency !== 'number' || !Number.isFinite(concurrency) || concurrency < 1) {
      errors.push({
        field: 'codemap.concurrency',
        message: 'Must be a number >= 1',
      });
    }
  }

  const maxTokens = config.context?.maxTokens;
  if (maxTokens !== undefined) {
    if (typeof maxTokens !== 'number' || !Number.isFinite(maxTokens) || maxTokens < 1024) {
      errors.push({
        field: 'context.maxTokens',
        message: 'Must be a number >= 1024',
      });
    }
  }

  const threshold = config.context?.compactThreshold;
  if (threshold !== undefined) {
    if (typeof threshold !== 'number' || !(threshold > 0 && threshold <= 1)) {
      errors.push({
        field: 'context.compactThreshold',
        message: 'Must be a number between 0 and 1',
      });
    }
  }

  const themeName = config.ui?.theme;
  if (themeName !== undefined) {
    if (typeof themeName !== 'string' || !isThemeName(themeName)) {
      errors.push({
        field: 'ui.theme',
        message: `Must be one of: ${themeNames().join(', ')}`,
      });
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
