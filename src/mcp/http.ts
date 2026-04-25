import { createMCPClient } from '@ai-sdk/mcp';
import { expandEnv, expandEnvMap, type StreamableHttpMcpServerConfig } from '../config.js';
import type { OpenedClient } from './types.js';

export async function openStreamableHttp(
  name: string,
  cfg: StreamableHttpMcpServerConfig,
): Promise<OpenedClient> {
  const url = expandEnv(cfg.url);
  const client = await createMCPClient({
    // @ai-sdk/mcp uses the literal `'http'` for its Streamable HTTP transport;
    // bonfire surfaces the spec name (`'streamable-http'`) in user config.
    transport: {
      type: 'http',
      url,
      headers: expandEnvMap(cfg.headers),
    },
  });
  const tools = await client.tools();
  console.error(
    `[mcp] ${name} (streamable-http: ${url}): loaded ${Object.keys(tools).length} tools`,
  );
  return { client, tools };
}
