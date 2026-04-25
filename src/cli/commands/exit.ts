import type { SlashCommand } from './types.js';

export const exitCommand: SlashCommand = {
  trigger: '/exit',
  description: 'Quit bonfire',
  match: (input) => input === '/exit' || input === '/quit',
  async run(ctx) {
    ctx.exit();
  },
};
