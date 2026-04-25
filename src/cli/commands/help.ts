import type { SlashCommand } from './types.js';

export function makeHelpCommand(getAll: () => SlashCommand[]): SlashCommand {
  return {
    trigger: '/help',
    description: 'Show this help',
    match: (input) => input === '/help' || input === '/?',
    async run(ctx, input) {
      ctx.appendLines({ kind: 'user', text: input });
      const all = getAll();
      const width = Math.max(...all.map((c) => (c.usage ?? c.trigger).length));
      const lines = all.map((c) => {
        const left = (c.usage ?? c.trigger).padEnd(width);
        return `  ${left}  ${c.description}`;
      });
      ctx.appendLines({
        kind: 'assistant',
        text: `Commands:\n${lines.join('\n')}\n\nDuring an approval prompt: y = yes, a = always (shell), n = no.`,
      });
    },
  };
}
