import type { SlashCommand } from './types.js';
import {
  compactHistory,
  contextStatus,
  estimateTokens,
  getContextSettings,
} from '../../agent/index.js';
import { buildSystemPrompt } from '../../agent/system-prompt.js';

function bar(ratio: number, width = 24): string {
  const filled = Math.max(0, Math.min(width, Math.round(ratio * width)));
  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`;
}

export const contextCommand: SlashCommand = {
  trigger: '/context',
  description: 'Show context-window usage for the current conversation',
  match: (input) => input.trim() === '/context',
  async run(ctx, input) {
    ctx.appendLines({ kind: 'user', text: input });
    const settings = await getContextSettings();
    const systemTokens = estimateTokens(await buildSystemPrompt(ctx.cwd));
    const history = ctx.getHistory();
    const status = contextStatus(history, systemTokens, settings.maxTokens);
    const pct = Math.round(status.ratio * 100);

    ctx.appendLines({
      kind: 'assistant',
      text: [
        `context  ${bar(status.ratio)}  ${pct}%`,
        `  ~${status.used.toLocaleString()} of ${status.max.toLocaleString()} tokens`,
        `  ${history.length} messages · system prompt ~${systemTokens} tokens`,
        `  auto-compact ${
          settings.autoCompact
            ? `at ${Math.round(settings.compactThreshold * 100)}%`
            : 'disabled'
        }`,
        '',
        'Set context.maxTokens in your config to match your model, then /compact to reclaim space.',
      ].join('\n'),
    });
  },
};

export const compactCommand: SlashCommand = {
  trigger: '/compact',
  description: 'Reclaim context by trimming old tool output and dropping old turns',
  match: (input) => input.trim() === '/compact',
  async run(ctx, input) {
    ctx.appendLines({ kind: 'user', text: input });
    const settings = await getContextSettings();
    const systemTokens = estimateTokens(await buildSystemPrompt(ctx.cwd));
    const history = ctx.getHistory();

    if (history.length === 0) {
      ctx.appendLines({ kind: 'assistant', text: 'Nothing to compact — history is empty.' });
      return;
    }

    const target = Math.max(1024, Math.floor(settings.maxTokens * 0.5) - systemTokens);
    const result = compactHistory(history, { targetTokens: target });

    if (!result.changed) {
      ctx.appendLines({
        kind: 'assistant',
        text: `Already compact — ~${result.tokensBefore.toLocaleString()} tokens across ${history.length} messages.`,
      });
      return;
    }

    ctx.setHistory(result.messages);
    const parts: string[] = [];
    if (result.droppedMessages > 0) parts.push(`dropped ${result.droppedMessages} old messages`);
    if (result.trimmedToolOutputs > 0) {
      parts.push(`trimmed ${result.trimmedToolOutputs} tool outputs`);
    }
    ctx.appendLines({
      kind: 'assistant',
      text: `Compacted · ${parts.join(' · ')} · ~${result.tokensBefore.toLocaleString()} → ~${result.tokensAfter.toLocaleString()} tokens`,
    });
  },
};
