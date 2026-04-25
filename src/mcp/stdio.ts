import { createMCPClient } from '@ai-sdk/mcp';
import { Experimental_StdioMCPTransport as StdioTransport } from '@ai-sdk/mcp/mcp-stdio';
import { expandEnv, expandEnvMap, type StdioMcpServerConfig } from '../config.js';
import { resolveWindowsCommand } from './windows.js';
import type { OpenedClient } from './types.js';

export async function openStdio(
  name: string,
  cfg: StdioMcpServerConfig,
): Promise<OpenedClient> {
  const command = resolveWindowsCommand(cfg.command);
  const args = (cfg.args ?? []).map((a) => expandEnv(a));
  const transport = new StdioTransport({
    command,
    args,
    env: { ...process.env, ...(expandEnvMap(cfg.env) ?? {}) } as Record<string, string>,
  });
  const client = await createMCPClient({ transport });
  const tools = await client.tools();
  console.error(
    `[mcp] ${name} (stdio: ${command}): loaded ${Object.keys(tools).length} tools`,
  );
  return { client, tools };
}
