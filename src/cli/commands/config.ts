import { loadConfig, saveConfig, clearConfigCache, getConfigPath, type NanoConfig } from '../../config.js';
import type { SlashCommand } from './types.js';

export async function getCurrentConfig(): Promise<NanoConfig> {
  return loadConfig();
}

export async function setConfig(newConfig: NanoConfig): Promise<void> {
  await saveConfig(newConfig);
  clearConfigCache();
}

function formatConfig(config: NanoConfig): string {
  const lines: string[] = [];
  lines.push('── Config ──');
  lines.push(`Path: ${getConfigPath()}`);
  lines.push('');

  if (config.provider) {
    lines.push('Provider:');
    lines.push(`  active: ${config.provider.active}`);
    if (config.provider.ollama) {
      lines.push(`  ollama:`);
      lines.push(`    baseURL: ${config.provider.ollama.baseURL}`);
      lines.push(`    model: ${config.provider.ollama.model}`);
    }
    if (config.provider['llama.cpp']) {
      lines.push(`  llama.cpp:`);
      lines.push(`    baseURL: ${config.provider['llama.cpp'].baseURL}`);
      lines.push(`    model: ${config.provider['llama.cpp'].model}`);
    }
    if (config.provider.remote) {
      lines.push(`  remote:`);
      lines.push(`    baseURL: ${config.provider.remote.baseURL}`);
      lines.push(`    model: ${config.provider.remote.model}`);
      if (config.provider.remote.apiKey) {
        lines.push(`    apiKey: ***`);
      }
    }
  }

  if (config.mcpServers && Object.keys(config.mcpServers).length > 0) {
    lines.push('');
    lines.push('MCP Servers:');
    for (const [name, server] of Object.entries(config.mcpServers)) {
      if ('command' in server) {
        lines.push(`  ${name}: ${server.command} ${server.args?.join(' ') || ''}`);
      } else if ('url' in server) {
        lines.push(`  ${name}: ${server.url}`);
      }
    }
  }

  if (config.security?.shell) {
    lines.push('');
    lines.push('Security:');
    lines.push(`  requireApproval: ${config.security.shell.requireApproval !== false}`);
  }

  lines.push('──');
  return lines.join('\n');
}

export const configCommand: SlashCommand = {
  trigger: '/config',
  description: 'Show current configuration (use /reconfigure to change it)',
  match: (input) => input === '/config',
  async run(ctx, input) {
    ctx.appendLines({ kind: 'user', text: input });
    try {
      const config = await loadConfig();
      ctx.appendLines({ kind: 'assistant', text: formatConfig(config) });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      ctx.appendLines({ kind: 'error', text: msg });
    }
  },
};
