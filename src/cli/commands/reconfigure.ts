import type { SlashCommand } from './types.js';

export const reconfigureCommand: SlashCommand = {
  trigger: '/reconfigure',
  description: 'Re-run the setup wizard to change provider/model',
  match: (input) => input === '/reconfigure',
  async run(ctx, input) {
    ctx.appendLines({ kind: 'user', text: input });
    ctx.enterReconfigure();
  },
};
