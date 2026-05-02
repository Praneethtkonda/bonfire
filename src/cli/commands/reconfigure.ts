import { reconfigure } from '../onboarding.js';
import { clearConfigCache } from '../../config.js';
import type { SlashCommand } from './types.js';

export const reconfigureCommand: SlashCommand = {
  trigger: '/reconfigure',
  description: 'Re-run the setup wizard to change provider/model',
  match: (input) => input === '/reconfigure',
  async run(ctx, input) {
    ctx.appendLines({ kind: 'user', text: input });
    try {
      const newConfig = await reconfigure();
      clearConfigCache();
      ctx.appendLines({ 
        kind: 'assistant', 
        text: `✅ Config updated!\nActive provider: ${newConfig.provider?.active}\n\nRestart bonfire for changes to take effect.` 
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      ctx.appendLines({ kind: 'error', text: msg });
    }
  },
};
