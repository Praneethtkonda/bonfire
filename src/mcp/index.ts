import { isStreamableHttpMcp, loadConfig, type McpServerConfig } from '../config.js';
import { requestApproval } from '../tools/approval.js';
import { openStdio } from './stdio.js';
import { openStreamableHttp } from './http.js';
import type { LoadedMcp, OpenedClient } from './types.js';

export type { LoadedMcp };

async function openServer(name: string, cfg: McpServerConfig): Promise<OpenedClient> {
  return isStreamableHttpMcp(cfg) ? openStreamableHttp(name, cfg) : openStdio(name, cfg);
}

interface ToolWithExecute {
  execute?: (args: unknown, ctx?: unknown) => Promise<unknown>;
}

/**
 * Wrap a tool so its `execute` first goes through the approval handler.
 * Used when `security.mcpRequireApproval` is set.
 *
 * Exported for unit testing.
 */
export function gateTool(name: string, tool: unknown): unknown {
  const t = tool as ToolWithExecute;
  if (!t || typeof t.execute !== 'function') return tool;
  const original = t.execute.bind(t);
  return {
    ...t,
    execute: async (args: unknown, ctx?: unknown) => {
      const decision = await requestApproval({ tool: 'mcp', name, args });
      if (decision === 'no') return { status: 'skipped', reason: 'denied by user' };
      return original(args, ctx);
    },
  };
}

export async function loadMcpServers(): Promise<LoadedMcp> {
  const config = await loadConfig();
  const servers = config.mcpServers ?? {};
  const requireApproval = config.security?.mcpRequireApproval ?? false;
  const clients: Array<{ close: () => Promise<void> }> = [];
  const tools: Record<string, unknown> = {};

  for (const [name, cfg] of Object.entries(servers)) {
    try {
      const { client, tools: serverTools } = await openServer(name, cfg);
      for (const [toolName, tool] of Object.entries(serverTools)) {
        const qualified = `${name}__${toolName}`;
        tools[qualified] = requireApproval ? gateTool(qualified, tool) : tool;
      }
      clients.push(client);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[mcp] ${name}: failed to start — ${msg}`);
    }
  }

  return {
    tools,
    close: async () => {
      await Promise.allSettled(clients.map((c) => c.close()));
    },
  };
}
