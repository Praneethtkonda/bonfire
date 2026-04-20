import { createMCPClient } from '@ai-sdk/mcp';
import { Experimental_StdioMCPTransport as StdioTransport } from '@ai-sdk/mcp/mcp-stdio';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpConfig {
  mcpServers?: Record<string, McpServerConfig>;
}

export interface LoadedMcp {
  tools: Record<string, any>;
  close: () => Promise<void>;
}

async function loadConfig(): Promise<McpConfig> {
  const path = resolve(process.cwd(), 'nano-code.config.json');
  try {
    const raw = await readFile(path, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export async function loadMcpServers(): Promise<LoadedMcp> {
  const config = await loadConfig();
  const servers = config.mcpServers ?? {};
  const clients: Array<{ close: () => Promise<void> }> = [];
  const tools: Record<string, any> = {};

  for (const [name, cfg] of Object.entries(servers)) {
    try {
      const transport = new StdioTransport({
        command: cfg.command,
        args: cfg.args ?? [],
        env: { ...process.env, ...(cfg.env ?? {}) } as Record<string, string>,
      });
      const client = await createMCPClient({ transport });
      const serverTools = await client.tools();
      for (const [toolName, tool] of Object.entries(serverTools)) {
        tools[`${name}__${toolName}`] = tool;
      }
      clients.push(client);
      console.error(
        `[mcp] ${name}: loaded ${Object.keys(serverTools).length} tools`
      );
    } catch (e: any) {
      console.error(`[mcp] ${name}: failed to start — ${e.message ?? e}`);
    }
  }

  return {
    tools,
    close: async () => {
      await Promise.allSettled(clients.map((c) => c.close()));
    },
  };
}
