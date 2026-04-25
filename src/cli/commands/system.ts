import { buildSystemPrompt } from '../../agent/system-prompt.js';
import type { SlashCommand } from './types.js';

export const systemCommand: SlashCommand = {
  trigger: '/system',
  description: 'Show the effective system prompt (base + overrides + skills)',
  match: (input) => input === '/system',
  async run(ctx, input) {
    ctx.appendLines({ kind: 'user', text: input });
    try {
      const prompt = await buildSystemPrompt(ctx.cwd);
      ctx.appendLines({
        kind: 'assistant',
        text: `── effective system prompt ──\n${prompt}\n── end ──\n\nOverride layers (each appended unless systemPromptMode='replace'):\n  ~/.bonfire/system.md     (global)\n  ${ctx.cwd}/.bonfire/system.md   (project)\n  bonfire.config.json → systemPrompt   (inline)`,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      ctx.appendLines({ kind: 'error', text: msg });
    }
  },
};
