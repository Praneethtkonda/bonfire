import type { SlashCommand } from './types.js';
import { listTools } from '../../agent/index.js';

export const toolsCommand: SlashCommand = {
  trigger: '/tools',
  description: 'List the tools currently available to the model',
  match: (input) => input.trim() === '/tools',
  async run(ctx, input) {
    ctx.appendLines({ kind: 'user', text: input });
    const all = listTools();
    if (all.length === 0) {
      ctx.appendLines({ kind: 'assistant', text: 'No tools are available.' });
      return;
    }
    const builtins = all.filter((t) => t.source === 'builtin');
    const mcp = all.filter((t) => t.source === 'mcp');
    const width = Math.max(...all.map((t) => t.name.length));

    const sections: string[] = [];
    if (builtins.length > 0) {
      sections.push(
        `Built-in (${builtins.length}):\n${builtins
          .map((t) => `  ${t.name.padEnd(width)}  ${t.description}`)
          .join('\n')}`,
      );
    }
    if (mcp.length > 0) {
      sections.push(
        `MCP (${mcp.length}):\n${mcp.map((t) => `  ${t.name}`).join('\n')}`,
      );
    }
    ctx.appendLines({ kind: 'assistant', text: sections.join('\n\n') });
  },
};
